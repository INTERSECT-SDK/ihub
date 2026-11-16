"""Exercise the rendered development proxy against an isolated echo upstream."""

import http.client
import json
import shutil
import subprocess
import tempfile
import time
import unittest
import uuid
from http import HTTPStatus
from http.client import HTTPMessage
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from test_ghcr import ROOT, isolated_environment

IMAGE = "nginx:1.29"
ROUTES = ("/hub/auth", "/api/v1/auth/login", "/ijupyterhub/hub/", "/auth/", "/")
REDIRECT_ROUTES = ("/docs", "/ijupyterhub", "/auth", "/ihub_mcp")


def docker(*arguments: str) -> str:
    result = subprocess.run(
        ["docker", *arguments],
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    )
    return result.stdout.strip()


@unittest.skipUnless(shutil.which("docker"), "Docker is required")
class NginxForwardedHeaderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        try:
            docker("info", "--format", "{{.ServerVersion}}")
            docker("image", "inspect", IMAGE)
        except subprocess.CalledProcessError as error:
            raise unittest.SkipTest(
                f"Running Docker and a local {IMAGE} image are required; run docker pull {IMAGE}"
            ) from error

        temporary = tempfile.TemporaryDirectory(prefix="ihub-nginx-headers-")
        cls.addClassCleanup(temporary.cleanup)
        directory = Path(temporary.name)
        network = f"ihub-config-test-{uuid.uuid4().hex[:12]}"
        docker("network", "create", network)
        cls.addClassCleanup(docker, "network", "rm", network)

        # Nginx itself supplies a tiny echo server. All template proxy_pass
        # authorities resolve on this private test network, including the two
        # fixed JupyterHub and Keycloak authorities.
        echo_config = directory / "echo.conf"
        echo_config.write_text("""
server {
  listen 9000;
  listen 8000;
  listen 8080;
  location / {
    default_type application/json;
    return 200 '{"host":"$http_host","forwarded_host":"$http_x_forwarded_host","port":"$http_x_forwarded_port","proto":"$http_x_forwarded_proto","uri":"$request_uri"}';
  }
}
""")
        echo = docker(
            "create",
            "--network",
            network,
            "--network-alias",
            "echo",
            "--network-alias",
            "ihub-jupyterhub",
            "--network-alias",
            "ihub-keycloak",
            IMAGE,
        )
        cls.addClassCleanup(docker, "rm", "-f", echo)
        docker("cp", str(echo_config), f"{echo}:/etc/nginx/conf.d/default.conf")
        docker("start", echo)

        rendered = directory / "proxy.conf"
        subprocess.run(
            [
                "sh",
                str(ROOT / "apps/backend/nginx_dev/render-upload-body-limit.sh"),
                str(ROOT / "apps/backend/nginx_dev/default.conf"),
                str(rendered),
            ],
            env=isolated_environment()
            | {
                "PROJECT_FILE_UPLOAD_MAX_BYTES": "10485760",
                **{
                    f"NGINX_{name}_UPSTREAM": "echo:9000"
                    for name in ("HUB", "MARKETPLACE", "SERVER", "DOCS", "MCP")
                },
            },
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        )
        cls.proxy = docker(
            "create",
            "--network",
            network,
            "-p",
            "127.0.0.1::8080",
            IMAGE,
        )
        cls.addClassCleanup(docker, "rm", "-f", cls.proxy)
        docker("cp", str(rendered), f"{cls.proxy}:/etc/nginx/conf.d/default.conf")
        docker("start", cls.proxy)
        docker("exec", cls.proxy, "nginx", "-t")
        cls.port = int(docker("port", cls.proxy, "8080/tcp").rsplit(":", 1)[1])
        deadline = time.monotonic() + 10
        while True:
            try:
                cls.request("/", "localhost:18080")
                break
            except (OSError, http.client.HTTPException):
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.1)

    @classmethod
    def request_response(
        cls, path: str, host: str | None
    ) -> tuple[int, HTTPMessage, bytes]:
        """Return the raw response without following redirects."""
        connection = http.client.HTTPConnection("127.0.0.1", cls.port, timeout=5)
        try:
            connection.putrequest("GET", path, skip_host=True)
            if host is not None:
                connection.putheader("Host", host)
            connection.endheaders()
            response = connection.getresponse()
            return response.status, response.headers, response.read()
        finally:
            connection.close()

    @classmethod
    def request(cls, path: str, host: str | None) -> dict:
        status, _, body = cls.request_response(path, host)
        if status != HTTPStatus.OK:
            raise AssertionError(f"Proxy returned {status}: {body!r}")
        return json.loads(body)

    def test_slash_redirects_preserve_relative_location_and_query(self) -> None:
        for host in (
            "localhost:8080",
            "localhost:18080",
            "example.test",
            "[::1]:18080",
        ):
            for path in REDIRECT_ROUTES:
                for query in ("", "?next=%2Fhub%3Fx%3D1&mode=login"):
                    with self.subTest(host=host, path=path, query=query):
                        status, headers, _ = self.request_response(path + query, host)
                        self.assertEqual(status, HTTPStatus.MOVED_PERMANENTLY)
                        self.assertEqual(headers["Location"], path + "/" + query)

    def test_slash_redirects_follow_on_published_port(self) -> None:
        authority = f"127.0.0.1:{self.port}"
        for path in REDIRECT_ROUTES:
            with self.subTest(path=path):
                query = "?next=%2Fhub&mode=login"
                url = f"http://{authority}{path}{query}"
                status, headers, _ = self.request_response(path + query, authority)
                self.assertEqual(status, HTTPStatus.MOVED_PERMANENTLY)
                target = urlsplit(urljoin(url, headers["Location"]))
                self.assertEqual(target.scheme, "http")
                self.assertEqual(target.netloc, authority)
                self.assertEqual(target.path, path + "/")
                self.assertEqual("?" + target.query, query)
                # Connect to the resolved URL, so a wrong port cannot be hidden
                # by the fixture's request helper.
                connection = http.client.HTTPConnection(target.netloc, timeout=5)
                try:
                    connection.request("GET", target.path + "?" + target.query)
                    response = connection.getresponse()
                    self.assertEqual(response.status, HTTPStatus.OK)
                    body = json.loads(response.read())
                    upstream_path = (
                        "/" if path in ("/docs", "/ihub_mcp") else path + "/"
                    )
                    self.assertEqual(body["uri"], upstream_path + query)
                finally:
                    connection.close()

    def test_public_authority_on_all_affected_routes(self) -> None:
        for host, port in (
            ("localhost:8080", "8080"),
            ("localhost:18080", "18080"),
            ("example.test", "80"),
            ("[::1]:18080", "18080"),
        ):
            for path in ROUTES:
                with self.subTest(host=host, path=path):
                    self.assertEqual(
                        self.request(path, host),
                        {
                            "host": host,
                            "forwarded_host": host,
                            "port": port,
                            "proto": "http",
                            "uri": path,
                        },
                    )

    def test_missing_host_falls_back_to_listening_port(self) -> None:
        # HTTP/1.0 permits a request without Host, unlike HTTP/1.1.
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            connection.connect()
            connection.send(b"GET /hub/auth HTTP/1.0\r\n\r\n")
            response = connection.response_class(connection.sock, method="GET")
            response.begin()
            self.assertEqual(response.status, 200)
            headers = json.loads(response.read())
            self.assertEqual(headers["port"], "8080")
            self.assertEqual(headers["host"], "_:8080")
            self.assertEqual(headers["forwarded_host"], "_:8080")
        finally:
            connection.close()


if __name__ == "__main__":
    unittest.main()
