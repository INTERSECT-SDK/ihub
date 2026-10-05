"""ihub-ui authentication behind Nginx, backed by ihub-server and Keycloak."""

from browser import Browser

# Keycloak test user from config/keycloak/ihub-realm.json.
EMAIL = "it.user@example.com"


def test_login_page_links_to_server_oauth(browser: Browser) -> None:
    response = browser.get("/hub/login")

    assert response.status == 200
    assert "/api/v1/auth" in response.text


def test_protected_page_redirects_to_login_without_session(browser: Browser) -> None:
    response = browser.get("/hub/project", follow_redirects=False)

    assert response.status in (302, 307, 308)
    assert response.headers.get("Location", "").endswith("/hub/login")


def test_oauth_login_creates_usable_session(authenticated_browser: Browser) -> None:
    assert authenticated_browser.has_cookie("IHUB_SESSION")
    user = authenticated_browser.get("/api/v1/auth/user")
    assert user.status == 200
    assert EMAIL in user.text
    assert (
        authenticated_browser.get("/hub/project", follow_redirects=False).status == 200
    )


def test_logout_clears_session(authenticated_browser: Browser) -> None:
    assert authenticated_browser.post("/api/v1/auth/logout").status == 200
    assert authenticated_browser.get("/api/v1/auth/user").status == 401


def test_guest_route_is_removed(browser: Browser) -> None:
    response = browser.post("/api/v1/auth/guest")

    assert response.status == 404
    assert not browser.has_cookie("IHUB_SESSION")
