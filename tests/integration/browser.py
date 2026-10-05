"""Cookie-keeping HTTP client that stands in for a browser in integration tests."""

import http.cookiejar
import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from email.message import Message


@dataclass(frozen=True)
class Response:
    status: int
    url: str
    headers: Message
    text: str


class _LocalhostSecureCookiePolicy(http.cookiejar.DefaultCookiePolicy):
    """Send Secure cookies to http://localhost, as browsers do for local origins.

    Keycloak marks its login cookies Secure even over plain HTTP.
    """

    def return_ok_secure(
        self, cookie: http.cookiejar.Cookie, request: urllib.request.Request
    ) -> bool:
        if urllib.parse.urlsplit(request.full_url).hostname in ("localhost", "127.0.0.1"):
            return True
        return super().return_ok_secure(cookie, request)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: object, **kwargs: object) -> None:
        return None


class Browser:
    """Minimal cookie-keeping HTTP client rooted at the stack's base URL."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.cookies = http.cookiejar.CookieJar(policy=_LocalhostSecureCookiePolicy())
        cookie_handler = urllib.request.HTTPCookieProcessor(self.cookies)
        self._following = urllib.request.build_opener(cookie_handler)
        self._not_following = urllib.request.build_opener(cookie_handler, _NoRedirect())

    def has_cookie(self, name: str) -> bool:
        return any(cookie.name == name for cookie in self.cookies)

    def get(self, path_or_url: str, *, follow_redirects: bool = True) -> Response:
        return self._send("GET", path_or_url, follow_redirects=follow_redirects)

    def post(
        self, path_or_url: str, data: dict[str, str] | None = None, *, follow_redirects: bool = True
    ) -> Response:
        body = urllib.parse.urlencode(data or {}).encode()
        return self._send("POST", path_or_url, body=body, follow_redirects=follow_redirects)

    def post_json(
        self, path_or_url: str, payload: object, *, headers: dict[str, str] | None = None
    ) -> Response:
        return self._send(
            "POST",
            path_or_url,
            body=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json", **(headers or {})},
        )

    def _send(
        self,
        method: str,
        path_or_url: str,
        *,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
        follow_redirects: bool = True,
    ) -> Response:
        url = urllib.parse.urljoin(self.base_url + "/", path_or_url)
        request = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
        opener = self._following if follow_redirects else self._not_following
        try:
            with opener.open(request, timeout=30) as resp:
                text = resp.read().decode(errors="replace")
                return Response(resp.status, resp.geturl(), resp.headers, text)
        except urllib.error.HTTPError as exc:
            text = exc.read().decode(errors="replace")
            return Response(exc.code, exc.geturl(), exc.headers, text)
