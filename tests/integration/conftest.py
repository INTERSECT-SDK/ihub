"""Fixtures for tests that run against the stack in compose.yaml.

The stack must already be up (``docker compose up --wait``); these tests only
talk to it over HTTP through the Nginx front door, like a browser would.
"""

import os
import html
import re
import urllib.error
import urllib.request
import urllib.parse
from collections.abc import Iterator

import pytest

from browser import Browser

BASE_URL = os.environ.get("IT_BASE_URL", f"http://localhost:{os.environ.get('IT_PORT', '18080')}")
OIDC_USERNAME = "it-user"
OIDC_PASSWORD = "it-password"


@pytest.fixture(scope="session", autouse=True)
def _stack_is_up() -> None:
    try:
        urllib.request.urlopen(f"{BASE_URL}/hub/login", timeout=10).close()
    except (urllib.error.URLError, ConnectionError) as exc:
        pytest.exit(
            f"iHub test stack is not reachable at {BASE_URL} ({exc}); start it with docker compose first.",
            1,
        )


@pytest.fixture
def browser() -> Iterator[Browser]:
    """A fresh browser session with an empty cookie jar."""
    yield Browser(BASE_URL)


def login_with_oidc(browser: Browser) -> None:
    """Authenticate a browser through the integration Keycloak realm."""
    login_form = browser.get("/api/v1/auth")
    assert login_form.status == 200
    match = re.search(r'<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"', login_form.text)
    assert match, f"Keycloak login form not found at {login_form.url}"
    landing = browser.post(
        html.unescape(match.group(1)),
        {"username": OIDC_USERNAME, "password": OIDC_PASSWORD},
    )
    assert landing.status == 200
    assert urllib.parse.urlsplit(landing.url).path == "/hub/auth"


@pytest.fixture
def authenticated_browser(browser: Browser) -> Browser:
    """Return a browser authenticated as the integration OIDC user."""
    login_with_oidc(browser)
    return browser
