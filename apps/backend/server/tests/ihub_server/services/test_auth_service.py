import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.responses import RedirectResponse

from ihub_server.services import auth as auth_module
from ihub_server.services.auth import AuthService


class DummyRedis:
    def __init__(self):
        self.calls = []
        self._store = {}

    def json(self):
        return self

    async def set(self, *args):
        self.calls.append(args)
        self._store[args[0]] = args[2]

    async def get(self, key):
        return self._store.get(key)

    async def delete(self, key):
        self._store.pop(key, None)


class DummyRequest:
    def __init__(self, url_for_value: str | None = None):
        self._url_for_value = url_for_value
        self.session: dict = {}
        self.cookies: dict = {}
        self.headers: dict = {}
        self.client = None
        self.app = SimpleNamespace(state=SimpleNamespace(redis=DummyRedis()))

    def url_for(self, _name: str):
        return self._url_for_value


def test_login_redirect_missing_callback(monkeypatch):
    service = AuthService(session=None)
    monkeypatch.setattr(
        auth_module,
        "settings",
        SimpleNamespace(OAUTH_CALLBACK_URL=""),
    )

    with pytest.raises(HTTPException):
        asyncio.run(service.login_redirect(DummyRequest(url_for_value=None)))


def test_login_redirect_success(monkeypatch):
    service = AuthService(session=None)
    request = DummyRequest(url_for_value="http://callback")
    monkeypatch.setattr(
        auth_module,
        "settings",
        SimpleNamespace(OAUTH_CALLBACK_URL=""),
    )

    async def fake_redirect(_request, url_for, **_kwargs):
        return RedirectResponse(url_for)

    monkeypatch.setattr(auth_module.oauth_session.keycloak, "authorize_redirect", fake_redirect)

    response = asyncio.run(service.login_redirect(request))

    assert isinstance(response, RedirectResponse)
    assert response.headers["location"] == "http://callback"


def test_login_callback_sets_session_and_cookie_from_userinfo(monkeypatch):
    service = AuthService(session=None)
    request = DummyRequest(url_for_value="http://callback")

    async def fake_access_token(_request):
        return {"id_token": "id", "access_token": "access", "refresh_token": "refresh"}

    async def fake_fetch_userinfo(_access_token):
        return {
            "email": "Allowed.User@Example.com",
            "sub": "subject-1",
            "name": "Allowed User",
        }

    monkeypatch.setattr(
        auth_module.oauth_session.keycloak,
        "authorize_access_token",
        fake_access_token,
    )
    monkeypatch.setattr(service, "_fetch_userinfo", fake_fetch_userinfo)
    monkeypatch.setattr(
        auth_module.jwt,
        "decode",
        lambda *_args, **_kwargs: pytest.fail(
            "id_token decode should not be used when userinfo exists"
        ),
    )
    monkeypatch.setattr(
        auth_module.auth_audit_repository,
        "get_active_authorized_user_by_email",
        lambda *_args, **_kwargs: object(),
    )
    monkeypatch.setattr(
        auth_module.auth_audit_repository,
        "create_login_audit_log",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(auth_module.secrets, "token_urlsafe", lambda *_args: "session-id")

    response = asyncio.run(service.login_callback(request))

    assert request.session["session_id"] == "session-id"
    assert request.app.state.redis.calls == [
        (
            "session-id",
            auth_module.Path.root_path(),
            {
                "id_token": "id",
                "access_token": "access",
                "refresh_token": "refresh",
                "email": "allowed.user@example.com",
                "subject_id": "subject-1",
                "claims": {
                    "email": "Allowed.User@Example.com",
                    "sub": "subject-1",
                    "name": "Allowed User",
                },
                "role": "user",
            },
        )
    ]
    assert response.status_code == 303
    assert response.headers["location"] == "https://example.com/redirect"
    assert "IHUB_SESSION=session-id" in response.headers.get("set-cookie", "")


def test_user_info_missing_user():
    service = AuthService(session=None)

    with pytest.raises(HTTPException):
        service.user_info(None)


def test_user_info_returns_normalized_payload(monkeypatch):
    service = AuthService(session=None)
    monkeypatch.setattr(
        auth_module.jwt,
        "decode",
        lambda *_args, **_kwargs: {
            "sub": "subject-1",
            "email": "User.Name@Example.com",
            "name": "User Name",
            "exp": 1234567890,
        },
    )

    response = service.user_info({"id_token": "token"})

    assert response.body == (
        b'{"sub":"subject-1","email":"user.name@example.com","name":"User Name",'
        b'"given_name":"User","family_name":"Name","preferred_username":"user.name",'
        b'"role":"user","exp":1234567890}'
    )


def test_user_info_applies_default_name_fallbacks(monkeypatch):
    service = AuthService(session=None)
    monkeypatch.setattr(
        auth_module.jwt,
        "decode",
        lambda *_args, **_kwargs: {
            "sub": "subject-2",
            "email": "Fallback.User@Example.com",
        },
    )

    response = service.user_info({"id_token": "token"})

    assert response.body == (
        b'{"sub":"subject-2","email":"fallback.user@example.com","name":"",'
        b'"given_name":"fallback.user","family_name":"User",'
        b'"preferred_username":"fallback.user","role":"user","exp":""}'
    )


def test_login_callback_falls_back_to_id_token_claims_when_userinfo_missing(monkeypatch):
    service = AuthService(session=None)
    request = DummyRequest(url_for_value="http://callback")

    async def fake_access_token(_request):
        return {"id_token": "id", "access_token": "access", "refresh_token": "refresh"}

    async def fake_fetch_userinfo(_access_token):
        return {}

    monkeypatch.setattr(
        auth_module.oauth_session.keycloak,
        "authorize_access_token",
        fake_access_token,
    )
    monkeypatch.setattr(service, "_fetch_userinfo", fake_fetch_userinfo)
    monkeypatch.setattr(
        auth_module.jwt,
        "decode",
        lambda *_args, **_kwargs: {
            "email": "fallback.user@example.com",
            "sub": "fallback-subject",
        },
    )
    monkeypatch.setattr(
        auth_module.auth_audit_repository,
        "get_active_authorized_user_by_email",
        lambda *_args, **_kwargs: object(),
    )
    monkeypatch.setattr(
        auth_module.auth_audit_repository,
        "create_login_audit_log",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(auth_module.secrets, "token_urlsafe", lambda *_args: "fallback-session")

    response = asyncio.run(service.login_callback(request))

    assert request.session["session_id"] == "fallback-session"
    assert request.app.state.redis.calls[0][2]["email"] == "fallback.user@example.com"
    assert request.app.state.redis.calls[0][2]["subject_id"] == "fallback-subject"
    assert request.app.state.redis.calls[0][2]["claims"] == {
        "email": "fallback.user@example.com",
        "sub": "fallback-subject",
    }
    assert request.app.state.redis.calls[0][2]["role"] == "user"
    assert response.headers["location"] == "https://example.com/redirect"


@pytest.mark.parametrize(
    ("exception_factory", "expected_detail"),
    [
        (
            lambda: auth_module.MismatchingStateError(),
            "OAuth state mismatch. Please retry login and ensure browser cookies are enabled.",
        ),
        (
            lambda: auth_module.OAuthError(error="access_denied"),
            "OAuth callback failed: access_denied: ",
        ),
    ],
)
def test_login_callback_logs_and_raises_http_exceptions(
    monkeypatch, exception_factory, expected_detail
):
    service = AuthService(session=None)
    request = DummyRequest(url_for_value="http://callback")
    request.headers = {"x-forwarded-for": "10.0.0.1, 10.0.0.2", "user-agent": "pytest-agent"}

    audit_events = []

    async def fake_access_token(_request):
        raise exception_factory()

    monkeypatch.setattr(
        auth_module.oauth_session.keycloak,
        "authorize_access_token",
        fake_access_token,
    )
    monkeypatch.setattr(
        auth_module.auth_audit_repository,
        "create_login_audit_log",
        lambda _session, log_entry: audit_events.append(log_entry),
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(service.login_callback(request))

    assert exc_info.value.detail == expected_detail
    assert audit_events[0].email is None
    assert audit_events[0].subject_id is None
    assert audit_events[0].ip_address == "10.0.0.1"
    assert audit_events[0].user_agent == "pytest-agent"


@pytest.mark.parametrize(
    ("claims", "is_authorized", "expected_reason", "expected_email"),
    [
        (
            {"sub": "subject-1", "upn": "missing@example.com"},
            True,
            "missing_email",
            "missing@example.com",
        ),
        (
            {"email": "blocked.user@example.com", "sub": "subject-2"},
            False,
            "not_authorized",
            "blocked.user@example.com",
        ),
    ],
)
def test_login_callback_redirects_for_missing_or_unauthorized_email(
    monkeypatch,
    claims,
    is_authorized,
    expected_reason,
    expected_email,
):
    service = AuthService(session=None)
    request = DummyRequest(url_for_value="http://callback")

    async def fake_access_token(_request):
        return {"id_token": "id", "access_token": "access", "refresh_token": "refresh"}

    async def fake_fetch_userinfo(_access_token):
        return claims

    audit_events = []

    monkeypatch.setattr(
        auth_module.oauth_session.keycloak,
        "authorize_access_token",
        fake_access_token,
    )
    monkeypatch.setattr(service, "_fetch_userinfo", fake_fetch_userinfo)
    monkeypatch.setattr(service, "_is_email_authorized", lambda _email: is_authorized)
    monkeypatch.setattr(
        auth_module.auth_audit_repository,
        "create_login_audit_log",
        lambda _session, log_entry: audit_events.append(log_entry),
    )

    response = asyncio.run(service.login_callback(request))

    assert response.status_code == 303
    assert f"reason={expected_reason}" in response.headers["location"]
    assert f"email={expected_email.replace('@', '%40')}" in response.headers["location"]
    assert request.app.state.redis.calls == []
    assert audit_events[0].event_type == auth_module.LoginEventType.LOGIN_FAILURE


def test_user_info_dev_bypass_returns_normalized_payload(monkeypatch):
    service = AuthService(session=None)
    monkeypatch.setattr(
        auth_module,
        "settings",
        SimpleNamespace(AUTH_MODE="dev_bypass", ENVIRONMENT="development"),
    )

    response = service.user_info(
        {
            "auth_mode": "dev_bypass",
            "subject_id": "dev-bypass:dev.user@example.com",
            "email": "Dev.User@Example.com",
            "name": "Dev User",
        }
    )

    assert response.body == (
        b'{"sub":"dev-bypass:dev.user@example.com","email":"dev.user@example.com",'
        b'"name":"Dev User","given_name":"Dev","family_name":"User",'
        b'"preferred_username":"dev.user","auth_mode":"dev_bypass","role":"user","exp":""}'
    )


def test_logout_clears_existing_session_and_logs(monkeypatch):
    service = AuthService(session=None)
    request = DummyRequest(url_for_value="http://callback")
    request.cookies["IHUB_SESSION"] = "session-id"
    request.headers = {"user-agent": "pytest-agent"}
    request.client = SimpleNamespace(host="127.0.0.1")
    request.app.state.redis._store["session-id"] = {
        "email": "User.Name@Example.com",
        "sub": "subject-1",
    }

    audit_events = []
    monkeypatch.setattr(
        auth_module.auth_audit_repository,
        "create_login_audit_log",
        lambda _session, log_entry: audit_events.append(log_entry),
    )

    response = asyncio.run(service.logout(request))

    assert response.body == b'{"message":"Logged out successfully"}'
    assert "IHUB_SESSION=" in response.headers.get("set-cookie", "")
    assert request.app.state.redis._store == {}
    assert audit_events[0].event_type == auth_module.LoginEventType.LOGOUT
    assert audit_events[0].email == "user.name@example.com"
    assert audit_events[0].subject_id == "subject-1"
    assert audit_events[0].ip_address == "127.0.0.1"
    assert audit_events[0].user_agent == "pytest-agent"


def test_logout_logs_without_mapped_session_payload(monkeypatch):
    service = AuthService(session=None)
    request = DummyRequest(url_for_value="http://callback")
    request.cookies["IHUB_SESSION"] = "session-id"
    request.client = SimpleNamespace(host="192.168.1.10")
    request.app.state.redis._store["session-id"] = "not-a-mapping"

    audit_events = []
    monkeypatch.setattr(
        auth_module.auth_audit_repository,
        "create_login_audit_log",
        lambda _session, log_entry: audit_events.append(log_entry),
    )

    response = asyncio.run(service.logout(request))

    assert response.body == b'{"message":"Logged out successfully"}'
    assert request.app.state.redis._store == {}
    assert audit_events[0].event_type == auth_module.LoginEventType.LOGOUT
    assert audit_events[0].email is None
    assert audit_events[0].subject_id is None
    assert audit_events[0].ip_address == "192.168.1.10"


def test_fetch_userinfo_returns_payload_and_handles_errors(monkeypatch):
    service = AuthService(session=None)
    monkeypatch.setattr(
        auth_module,
        "settings",
        SimpleNamespace(OAUTH_USERDATA_URL="https://userinfo.example.com", OAUTH_CALLBACK_URL=""),
    )

    class SuccessResponse:
        status_code = 200

        @staticmethod
        def json():
            return {"email": "allowed.user@example.com"}

    class SuccessClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, headers=None, timeout=None):
            assert url == "https://userinfo.example.com"
            assert headers == {"Authorization": "Bearer access-token"}
            assert timeout == 10.0
            return SuccessResponse()

    monkeypatch.setattr(auth_module.httpx, "AsyncClient", lambda: SuccessClient())

    assert asyncio.run(service._fetch_userinfo("access-token")) == {
        "email": "allowed.user@example.com"
    }

    class ErrorClient(SuccessClient):
        async def get(self, *_args, **_kwargs):
            raise auth_module.httpx.HTTPError("boom")

    monkeypatch.setattr(auth_module.httpx, "AsyncClient", lambda: ErrorClient())

    assert asyncio.run(service._fetch_userinfo("access-token")) == {}
    assert asyncio.run(service._fetch_userinfo(None)) == {}


@pytest.mark.parametrize(
    ("response_status", "response_body"),
    [
        (401, {"error": "unauthorized"}),
        (200, ["not", "a", "dict"]),
    ],
)
def test_fetch_userinfo_returns_empty_for_non_200_or_non_dict(
    monkeypatch, response_status, response_body
):
    service = AuthService(session=None)
    monkeypatch.setattr(
        auth_module,
        "settings",
        SimpleNamespace(OAUTH_USERDATA_URL="https://userinfo.example.com", OAUTH_CALLBACK_URL=""),
    )

    class Response:
        status_code = response_status

        @staticmethod
        def json():
            return response_body

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, *_args, **_kwargs):
            return Response()

    monkeypatch.setattr(auth_module.httpx, "AsyncClient", lambda: Client())

    assert asyncio.run(service._fetch_userinfo("access-token")) == {}


def test_auth_helper_methods_cover_edge_cases(monkeypatch):
    service = AuthService(session=None)
    monkeypatch.setattr(
        auth_module,
        "settings",
        SimpleNamespace(
            OAUTH_UNAUTHORIZED_REDIRECT_URL="https://example.com/unauthorized?source=ihub",
            OAUTH_REDIRECT_URL="https://example.com/redirect",
            OAUTH_CALLBACK_URL="https://callback.example.com",
            AUTH_MODE="dev_bypass",
            ENVIRONMENT="development",
            DEV_AUTH_EMAIL=" Dev.User@Example.com ",
            DEV_AUTH_NAME=" Local Dev User ",
        ),
    )

    redirect = service._redirect_unauthorized(reason="missing_email", email="user@example.com")
    assert redirect.headers["location"] == (
        "https://example.com/unauthorized?source=ihub&reason=missing_email&email=user%40example.com"
    )
    no_email_redirect = service._redirect_unauthorized(reason="missing_email", email=None)
    assert no_email_redirect.headers["location"] == (
        "https://example.com/unauthorized?source=ihub&reason=missing_email"
    )
    assert service._is_dev_bypass_enabled() is True
    assert service._extract_user_claims({"claims": {"sub": "cached"}}) == {"sub": "cached"}
    assert service._extract_user_claims({"id_token": object()}) == {}
    assert service._decode_token_claims(object()) == {}

    def raise_jwt_error(*_args, **_kwargs):
        raise auth_module.jwt.PyJWTError("bad token")

    monkeypatch.setattr(auth_module.jwt, "decode", raise_jwt_error)
    assert service._decode_token_claims("bad-token") == {}
    assert (
        service._extract_normalized_email({"preferred_username": " User@Example.com "})
        == "user@example.com"
    )
    assert service._extract_normalized_email({"email": 3}) is None
    assert service._extract_subject_id({"subject_id": " subject-1 "}) == "subject-1"
    assert service._extract_subject_id({"sub": 123}) is None
    assert (
        service._extract_redirect_email({"unique_name": " User@Example.com "}) == "user@example.com"
    )
    assert service._extract_redirect_email({"email": "not-an-email"}) is None
    assert (
        service._get_client_ip(SimpleNamespace(headers={}, client=SimpleNamespace(host="10.1.2.3")))
        == "10.1.2.3"
    )
    assert service._get_client_ip(SimpleNamespace(headers={}, client=None)) is None
    assert service._get_user_agent(SimpleNamespace(headers={})) is None
    monkeypatch.setattr(
        auth_module.auth_audit_repository,
        "get_active_authorized_user_by_email",
        lambda *_args, **_kwargs: None,
    )
    assert service._is_email_authorized("person@example.com") is False

    monkeypatch.setattr(
        auth_module.auth_audit_repository,
        "get_active_authorized_user_by_email",
        lambda *_args, **_kwargs: object(),
    )
    assert service._is_email_authorized("person@example.com") is True


def test_dev_bypass_login_redirect_and_session_creation(monkeypatch):
    service = AuthService(session=None)
    request = DummyRequest(url_for_value="http://callback")
    audit_events = []
    authorized_user_emails = []
    monkeypatch.setattr(
        auth_module,
        "settings",
        SimpleNamespace(
            AUTH_MODE="dev_bypass",
            ENVIRONMENT="development",
            DEV_AUTH_EMAIL=" Dev.User@Example.com ",
            DEV_AUTH_NAME=" Local Dev User ",
            OAUTH_REDIRECT_URL="https://example.com/redirect",
            OAUTH_CALLBACK_URL="https://callback.example.com",
        ),
    )
    monkeypatch.setattr(auth_module.secrets, "token_urlsafe", lambda *_args: "dev-session")
    monkeypatch.setattr(
        auth_module.auth_audit_repository,
        "create_login_audit_log",
        lambda _session, log_entry: audit_events.append(log_entry),
    )
    monkeypatch.setattr(
        auth_module.auth_audit_repository,
        "ensure_authorized_user_exists",
        lambda _session, email: authorized_user_emails.append(email),
    )

    response = asyncio.run(service.login_redirect(request))

    assert response.headers["location"] == "https://example.com/redirect"
    assert request.session["session_id"] == "dev-session"
    assert authorized_user_emails == ["dev.user@example.com"]
    assert request.app.state.redis.calls == [
        (
            "dev-session",
            auth_module.Path.root_path(),
            {
                "auth_mode": "dev_bypass",
                "subject_id": "dev-bypass:dev.user@example.com",
                "email": "dev.user@example.com",
                "name": "Local Dev User",
                "role": "user",
            },
        )
    ]
    assert audit_events[0].event_type == auth_module.LoginEventType.LOGIN_SUCCESS


def test_login_callback_sets_non_secure_cookie_for_http_callback(monkeypatch):
    service = AuthService(session=None)
    request = DummyRequest(url_for_value="http://callback")

    async def fake_access_token(_request):
        return {"id_token": "id", "access_token": "access", "refresh_token": "refresh"}

    async def fake_fetch_userinfo(_access_token):
        return {
            "email": "Allowed.User@Example.com",
            "sub": "subject-1",
            "name": "Allowed User",
        }

    monkeypatch.setattr(
        auth_module.oauth_session.keycloak,
        "authorize_access_token",
        fake_access_token,
    )
    monkeypatch.setattr(service, "_fetch_userinfo", fake_fetch_userinfo)
    monkeypatch.setattr(
        auth_module.auth_audit_repository,
        "get_active_authorized_user_by_email",
        lambda *_args, **_kwargs: object(),
    )
    monkeypatch.setattr(
        auth_module.auth_audit_repository,
        "create_login_audit_log",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(auth_module.secrets, "token_urlsafe", lambda *_args: "session-id")
    monkeypatch.setattr(
        auth_module,
        "settings",
        SimpleNamespace(
            OAUTH_CALLBACK_URL="http://callback.example.com",
            OAUTH_REDIRECT_URL="https://example.com/redirect",
        ),
    )

    response = asyncio.run(service.login_callback(request))

    assert "IHUB_SESSION=session-id" in response.headers.get("set-cookie", "")
    assert "httponly" in response.headers.get("set-cookie", "").lower()
    assert "secure" not in response.headers.get("set-cookie", "").lower()
