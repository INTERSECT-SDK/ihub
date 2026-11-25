"""Compose settings regressions; run with unittest discover -s tests/config -v."""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC_URLS = {
    "server": {
        "OAUTH_REDIRECT_URL": "/hub/auth",
        "OAUTH_CALLBACK_URL": "/api/v1/auth/callback",
        "OAUTH_UNAUTHORIZED_REDIRECT_URL": "/hub/unauthorized",
    },
    "ihub-jupyterhub": {
        "JUPYTER_PUBLIC_URL": "/ijupyterhub",
        "JUPYTER_OAUTH_CALLBACK_URL": "/ijupyterhub/hub/oauth_callback",
    },
}
COMPOSE_VARIANTS = (
    "docker-compose.dev.yml",
    "docker-compose.dev-full.yml",
    "docker-compose.ghcr.yml",
    "docker-compose.prod.yml",
)
KEYCLOAK_ENDPOINTS = {
    "KEYCLOAK_AUTHORIZE_URL": "auth",
    "KEYCLOAK_TOKEN_URL": "token",
    "KEYCLOAK_JWKS_URL": "certs",
}
INTERNAL_KEYCLOAK_URL = (
    "http://ihub-keycloak:8080/auth/realms/master/protocol/openid-connect"
)


def isolated_environment() -> dict[str, str]:
    """Keep CLI access without inheriting project settings or Compose overrides."""
    return {
        key: value
        for key, value in os.environ.items()
        if key in {"PATH", "HOME", "DOCKER_CONFIG", "DOCKER_HOST", "DOCKER_CONTEXT"}
    }


@unittest.skipUnless(shutil.which("docker"), "Docker Compose CLI is required")
class ComposePublicURLTests(unittest.TestCase):
    def resolve(
        self,
        directory: Path,
        variables: dict[str, str],
        *,
        example: bool = False,
        compose: str = "docker-compose.ghcr.yml",
        env_text: str | None = None,
    ) -> dict:
        env_file = directory / ".env"
        if env_text is None:
            env_text = (ROOT / ".env.example").read_text() if example else ""
        env_file.write_text(env_text)
        result = subprocess.run(
            [
                "docker",
                "compose",
                "--env-file",
                str(env_file),
                "-f",
                str(ROOT / compose),
                "config",
                "--format",
                "json",
            ],
            cwd=directory,
            env=isolated_environment() | variables,
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
        return json.loads(result.stdout)["services"]

    def assert_public_urls(self, services: dict, port: int) -> None:
        self.assertEqual(services["nginx"]["ports"][0]["published"], str(port))
        self.assertEqual(services["nginx"]["ports"][0]["target"], 8080)
        for service, urls in PUBLIC_URLS.items():
            for variable, path in urls.items():
                with self.subTest(service=service, variable=variable):
                    self.assertEqual(
                        services[service]["environment"][variable],
                        f"http://localhost:{port}{path}",
                    )
        # Public URL changes must not alter container-to-container addresses.
        self.assertEqual(
            services["server"]["environment"]["JH_HOST"],
            "http://ihub-jupyterhub:8000/ijupyterhub",
        )
        self.assertEqual(
            services["nginx"]["environment"]["NGINX_SERVER_UPSTREAM"],
            "ihub-server:8000",
        )
        self.assertEqual(services["server"]["environment"]["AUTH_MODE"], "dev_bypass")

    def assert_compatible_settings(
        self,
        services: dict,
        compose: str,
        expected: dict[str, str],
    ) -> None:
        hub_env = services["ihub-jupyterhub"]["environment"]
        for name in ("KEYCLOAK_AUTHORIZE_URL", "KEYCLOAK_TOKEN_URL"):
            self.assertEqual(
                hub_env[name.replace("KEYCLOAK_", "OAUTH_")], expected[name]
            )
        token = expected["JUPYTER_HUB_ADMIN_TOKEN"]
        self.assertEqual(hub_env["JH_ADMIN_TOKEN"], token)
        if "server" in services:
            server_env = services["server"]["environment"]
            self.assertEqual(server_env["JH_ADMIN_TOKEN"], token)
            for name, endpoint in KEYCLOAK_ENDPOINTS.items():
                if compose == "docker-compose.dev-full.yml":
                    value = f"{INTERNAL_KEYCLOAK_URL}/{endpoint}"
                elif compose == "docker-compose.ghcr.yml" and not expected[name]:
                    value = f"{INTERNAL_KEYCLOAK_URL}/{endpoint}"
                else:
                    value = expected[name]
                self.assertEqual(server_env[name], value)

    def test_legacy_and_canonical_settings(self) -> None:
        names = tuple(KEYCLOAK_ENDPOINTS) + ("JUPYTER_HUB_ADMIN_TOKEN",)
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            # Compose config only resolves these paths; no TLS service is started.
            cert = directory / "cert.pem"
            key = directory / "private.key"
            cert.touch()
            key.touch()
            tls = {
                "NGINX_SERVER_NAME": "ihub.example.test",
                "TLS_CERT_FILE": str(cert),
                "TLS_KEY_FILE": str(key),
            }
            for scenario in (
                "legacy",
                "canonical",
                "mixed",
                "conflict",
                "empty_canonical",
                "absent",
                "empty",
            ):
                variables = {}
                expected = {}
                for index, name in enumerate(names):
                    legacy = (
                        "JUYTER_HUB_ADMIN_TOKEN"
                        if name == "JUPYTER_HUB_ADMIN_TOKEN"
                        else name.lower()
                    )
                    expected[name] = ""
                    if scenario in {
                        "legacy",
                        "conflict",
                        "empty_canonical",
                    } or (scenario == "mixed" and index % 2 == 0):
                        variables[legacy] = f"https://legacy.example.test/{name}"
                        expected[name] = variables[legacy]
                    if scenario in {"canonical", "conflict"} or (
                        scenario == "mixed" and index % 2 == 1
                    ):
                        variables[name] = f"https://canonical.example.test/{name}"
                        expected[name] = variables[name]
                    if scenario in {"empty_canonical", "empty"}:
                        variables[name] = ""
                    if scenario == "empty":
                        variables[legacy] = ""
                for compose in COMPOSE_VARIANTS:
                    resolved = expected.copy()
                    if (
                        compose == "docker-compose.ghcr.yml"
                        and not resolved["JUPYTER_HUB_ADMIN_TOKEN"]
                    ):
                        resolved["JUPYTER_HUB_ADMIN_TOKEN"] = (
                            "ihub_jupyter_hub_secret_key"
                        )
                    for source in ("shell", "file"):
                        with self.subTest(
                            scenario=scenario, compose=compose, source=source
                        ):
                            services = self.resolve(
                                directory,
                                tls | variables if source == "shell" else tls,
                                compose=compose,
                                env_text=""
                                if source == "shell"
                                else "\n".join(
                                    f"{name}={value}"
                                    for name, value in variables.items()
                                ),
                            )
                            self.assert_compatible_settings(services, compose, resolved)

    def test_defaults_and_copied_example_follow_port(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            for example in (False, True):
                # Empty port also exercises Compose's :- default semantics.
                for port_setting in (None, "", "18080"):
                    with self.subTest(example=example, port=port_setting):
                        variables = (
                            {}
                            if port_setting is None
                            else {"IHUB_HTTP_PORT": port_setting}
                        )
                        services = self.resolve(
                            Path(directory), variables, example=example
                        )
                        self.assert_public_urls(services, int(port_setting or "8080"))

    def test_port_from_copied_env(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env_text = (
                (ROOT / ".env.example")
                .read_text()
                .replace("# IHUB_HTTP_PORT=8080", "IHUB_HTTP_PORT=18080")
            )
            services = self.resolve(Path(directory), {}, env_text=env_text)
            self.assert_public_urls(services, 18080)

    def test_explicit_urls_override_port_defaults_and_example(self) -> None:
        overrides = {
            variable: f"https://ihub.example.test:9443{path}"
            for urls in PUBLIC_URLS.values()
            for variable, path in urls.items()
        }
        with tempfile.TemporaryDirectory() as directory:
            for example in (False, True):
                for source in ("shell", "file"):
                    with self.subTest(example=example, source=source):
                        variables = {"IHUB_HTTP_PORT": "18080"}
                        env_text = (
                            (ROOT / ".env.example").read_text() if example else ""
                        )
                        if source == "shell":
                            variables |= overrides
                        else:
                            env_text += "\n" + "\n".join(
                                f"{key}={value}" for key, value in overrides.items()
                            )
                        services = self.resolve(
                            Path(directory),
                            variables,
                            env_text=env_text,
                        )
                        self.assertEqual(
                            services["nginx"]["ports"][0]["published"], "18080"
                        )
                        for service, urls in PUBLIC_URLS.items():
                            for variable in urls:
                                self.assertEqual(
                                    services[service]["environment"][variable],
                                    overrides[variable],
                                )

    def test_existing_development_variants_resolve(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            for compose in (
                "docker-compose.dev.yml",
                "docker-compose.dev-full.yml",
            ):
                with self.subTest(compose=compose):
                    services = self.resolve(
                        Path(directory), {}, example=True, compose=compose
                    )
                    self.assertEqual(
                        services["nginx-dev"]["ports"][0]["published"], "8080"
                    )
                    self.assertEqual(
                        services["ihub-jupyterhub"]["environment"][
                            "JUPYTER_PUBLIC_URL"
                        ],
                        "http://localhost:8080/ijupyterhub",
                    )


if __name__ == "__main__":
    unittest.main()
