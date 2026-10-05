import asyncio
import os
from unittest.mock import AsyncMock

import httpx
import pytest

from ihub_server.services import jupyterhub as jupyterhub_module
from ihub_server.services.errors import ServiceError
from ihub_server.services.jupyterhub import JupyterHubService

REAL_ASYNC_CLIENT = httpx.AsyncClient


def _http_status_error(method: str, url: str, status_code: int = 500) -> httpx.HTTPStatusError:
    request = httpx.Request(method, url)
    response = httpx.Response(status_code, request=request)
    return httpx.HTTPStatusError("boom", request=request, response=response)


def test_list_user_servers_missing_token(monkeypatch):
    service = JupyterHubService()
    monkeypatch.delenv("JH_ADMIN_TOKEN", raising=False)
    monkeypatch.setenv("JH_HOST", "http://hub")

    with pytest.raises(ServiceError):
        asyncio.run(service.list_user_servers("user"))


def test_list_user_servers_missing_host(monkeypatch):
    service = JupyterHubService()
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.delenv("JH_HOST", raising=False)

    with pytest.raises(ServiceError):
        asyncio.run(service.list_user_servers("user"))


def test_list_user_servers_success(monkeypatch):
    service = JupyterHubService()
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.setenv("JH_HOST", "http://hub")
    monkeypatch.setattr(service, "ensure_user_exists", AsyncMock())

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"servers": {"": {"ready": True}}}

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, *_args, **_kwargs):
            return FakeResponse()

    monkeypatch.setattr(jupyterhub_module.httpx, "AsyncClient", lambda *_a, **_k: FakeAsyncClient())

    result = asyncio.run(service.list_user_servers("user"))

    assert result == {"": {"ready": True}}


def test_list_user_servers_http_error(monkeypatch):
    service = JupyterHubService()
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.setenv("JH_HOST", "http://hub")
    monkeypatch.setattr(service, "ensure_user_exists", AsyncMock())

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, *_args, **_kwargs):
            raise _http_status_error("GET", "http://hub")

    monkeypatch.setattr(jupyterhub_module.httpx, "AsyncClient", lambda *_a, **_k: FakeAsyncClient())

    with pytest.raises(ServiceError):
        asyncio.run(service.list_user_servers("user"))


def test_ensure_user_exists_creates_missing_user(monkeypatch):
    service = JupyterHubService()
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.setenv("JH_HOST", "http://hub")

    class FakeResponse:
        def __init__(self, *, error: httpx.HTTPStatusError | None = None):
            self._error = error

        def raise_for_status(self):
            if self._error is not None:
                raise self._error

    class FakeAsyncClient:
        def __init__(self):
            self.post_called = False

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, *_args, **_kwargs):
            return FakeResponse(error=_http_status_error("GET", "http://hub", status_code=404))

        async def post(self, *_args, **_kwargs):
            self.post_called = True
            return FakeResponse()

    fake_client = FakeAsyncClient()
    monkeypatch.setattr(jupyterhub_module.httpx, "AsyncClient", lambda *_a, **_k: fake_client)

    asyncio.run(service.ensure_user_exists("user"))

    assert fake_client.post_called is True


def test_ensure_user_exists_raises_for_non_404_http_error(monkeypatch):
    service = JupyterHubService()
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.setenv("JH_HOST", "http://hub")

    class FakeResponse:
        def raise_for_status(self):
            raise _http_status_error("GET", "http://hub")

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, *_args, **_kwargs):
            return FakeResponse()

    monkeypatch.setattr(jupyterhub_module.httpx, "AsyncClient", lambda *_a, **_k: FakeAsyncClient())

    with pytest.raises(ServiceError):
        asyncio.run(service.ensure_user_exists("user"))


def test_start_user_server_success(monkeypatch):
    service = JupyterHubService()
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.setenv("JH_HOST", "http://hub")
    monkeypatch.setattr(service, "ensure_user_exists", AsyncMock())

    class FakePostResponse:
        def raise_for_status(self):
            return None

    class FakePollResponse:
        def __init__(self, ready: bool = True):
            self._ready = ready

        def raise_for_status(self):
            return None

        def json(self):
            return {"servers": {"": {"ready": self._ready, "pending": None}}}

    class BaseClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, *_args, **_kwargs):
            msg = "Unexpected GET request"
            raise AssertionError(msg)

        async def post(self, *_args, **_kwargs):
            return FakePostResponse()

    class PollClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, *_args, **_kwargs):
            return FakePollResponse(ready=True)

    def fake_async_client(*_args, **kwargs):
        if "headers" in kwargs:
            return PollClient()
        return BaseClient()

    async def fast_sleep(_delay):
        return None

    monkeypatch.setattr(jupyterhub_module.httpx, "AsyncClient", fake_async_client)
    monkeypatch.setattr(asyncio, "sleep", fast_sleep)

    result = asyncio.run(service.start_user_server("user"))

    assert result["ready"] is True


def test_start_user_server_missing_token(monkeypatch):
    service = JupyterHubService()
    monkeypatch.delenv("JH_ADMIN_TOKEN", raising=False)
    monkeypatch.setenv("JH_HOST", "http://hub")

    with pytest.raises(ServiceError):
        asyncio.run(service.start_user_server("user"))


def test_start_user_server_missing_host(monkeypatch):
    service = JupyterHubService()
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.delenv("JH_HOST", raising=False)

    with pytest.raises(ServiceError):
        asyncio.run(service.start_user_server("user"))


def test_start_user_server_failed(monkeypatch):
    service = JupyterHubService()
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.setenv("JH_HOST", "http://hub")
    monkeypatch.setattr(service, "ensure_user_exists", AsyncMock())

    class FakePostResponse:
        def raise_for_status(self):
            return None

    class FakePollResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"servers": {"": {"ready": False, "pending": None}}}

    class BaseClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, *_args, **_kwargs):
            msg = "Unexpected GET request"
            raise AssertionError(msg)

        async def post(self, *_args, **_kwargs):
            return FakePostResponse()

    class PollClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, *_args, **_kwargs):
            return FakePollResponse()

    def fake_async_client(*_args, **kwargs):
        if "headers" in kwargs:
            return PollClient()
        return BaseClient()

    async def fast_sleep(_delay):
        return None

    monkeypatch.setattr(jupyterhub_module.httpx, "AsyncClient", fake_async_client)
    monkeypatch.setattr(asyncio, "sleep", fast_sleep)

    with pytest.raises(ServiceError):
        asyncio.run(service.start_user_server("user"))


def test_create_user_token_success(monkeypatch):
    service = JupyterHubService()
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.setenv("JH_HOST", "http://hub")
    monkeypatch.setattr(service, "ensure_user_exists", AsyncMock())

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"token": "abc"}

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *_args, **_kwargs):
            return FakeResponse()

    monkeypatch.setattr(jupyterhub_module.httpx, "AsyncClient", lambda *_a, **_k: FakeAsyncClient())

    result = asyncio.run(service.create_user_token("user"))

    assert result == {"token": "abc"}


def test_create_user_token_http_error(monkeypatch):
    service = JupyterHubService()
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.setenv("JH_HOST", "http://hub")
    monkeypatch.setattr(service, "ensure_user_exists", AsyncMock())

    class FakeResponse:
        def raise_for_status(self):
            raise _http_status_error("POST", "http://hub")

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *_args, **_kwargs):
            return FakeResponse()

    monkeypatch.setattr(jupyterhub_module.httpx, "AsyncClient", lambda *_a, **_k: FakeAsyncClient())

    with pytest.raises(ServiceError):
        asyncio.run(service.create_user_token("user"))


def test_create_user_token_missing_env(monkeypatch):
    service = JupyterHubService()
    monkeypatch.delenv("JH_ADMIN_TOKEN", raising=False)
    monkeypatch.delenv("JH_HOST", raising=False)

    with pytest.raises(ServiceError):
        asyncio.run(service.create_user_token("user"))


def test_create_user_token_if_exists_success(monkeypatch):
    service = JupyterHubService()
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.setenv("JH_HOST", "http://hub")
    calls = []

    class FakeResponse:
        def __init__(self, payload=None):
            self._payload = payload or {}

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, **kwargs):
            calls.append(("get", url, kwargs))
            return FakeResponse()

        async def post(self, url, **kwargs):
            calls.append(("post", url, kwargs))
            return FakeResponse({"token": "abc"})

    monkeypatch.setattr(jupyterhub_module.httpx, "AsyncClient", lambda *_a, **_k: FakeAsyncClient())

    result = asyncio.run(service.create_user_token_if_exists("user@example.com"))

    assert result == {"token": "abc"}
    assert calls[0] == (
        "get",
        "http://hub/hub/api/users/user@example.com",
        {
            "headers": {
                "Authorization": "token token",
                "Content-Type": "application/json",
            },
            "timeout": 30.0,
        },
    )
    assert calls[1] == (
        "post",
        "http://hub/hub/api/users/user@example.com/tokens",
        {
            "headers": {
                "Authorization": "token token",
                "Content-Type": "application/json",
            },
            "json": {
                "note": "Token created via iHub API for user user@example.com",
                "scopes": ["access:servers!user=user@example.com"],
            },
        },
    )


def test_create_user_token_if_exists_returns_none_for_missing_user(monkeypatch):
    service = JupyterHubService()
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.setenv("JH_HOST", "http://hub")
    post_called = False

    class FakeResponse:
        def raise_for_status(self):
            raise _http_status_error(
                "GET",
                "http://hub/hub/api/users/user@example.com",
                status_code=404,
            )

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, *_args, **_kwargs):
            return FakeResponse()

        async def post(self, *_args, **_kwargs):
            nonlocal post_called
            post_called = True
            return FakeResponse()

    monkeypatch.setattr(jupyterhub_module.httpx, "AsyncClient", lambda *_a, **_k: FakeAsyncClient())

    result = asyncio.run(service.create_user_token_if_exists("user@example.com"))

    assert result is None
    assert post_called is False


def test_create_user_token_if_exists_returns_none_for_token_http_error(monkeypatch):
    service = JupyterHubService()
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.setenv("JH_HOST", "http://hub")

    class FakeUserResponse:
        def raise_for_status(self):
            return None

    class FakeTokenResponse:
        def raise_for_status(self):
            raise _http_status_error(
                "POST",
                "http://hub/hub/api/users/user@example.com/tokens",
                status_code=500,
            )

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, *_args, **_kwargs):
            return FakeUserResponse()

        async def post(self, *_args, **_kwargs):
            return FakeTokenResponse()

    monkeypatch.setattr(jupyterhub_module.httpx, "AsyncClient", lambda *_a, **_k: FakeAsyncClient())

    result = asyncio.run(service.create_user_token_if_exists("user@example.com"))

    assert result is None


def test_ensure_user_exists_user_already_exists(monkeypatch):
    service = JupyterHubService()
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.setenv("JH_HOST", "http://hub")

    class FakeResponse:
        def raise_for_status(self):
            return None

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, *_args, **_kwargs):
            return FakeResponse()

    monkeypatch.setattr(jupyterhub_module.httpx, "AsyncClient", lambda *_a, **_k: FakeAsyncClient())

    asyncio.run(service.ensure_user_exists("user"))


def test_ensure_user_exists_raises_when_create_fails(monkeypatch):
    service = JupyterHubService()
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.setenv("JH_HOST", "http://hub")

    class FakeResponse:
        def __init__(self, *, error: httpx.HTTPStatusError | None = None):
            self._error = error

        def raise_for_status(self):
            if self._error is not None:
                raise self._error

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, *_args, **_kwargs):
            return FakeResponse(error=_http_status_error("GET", "http://hub", status_code=404))

        async def post(self, *_args, **_kwargs):
            return FakeResponse(error=_http_status_error("POST", "http://hub", status_code=500))

    monkeypatch.setattr(jupyterhub_module.httpx, "AsyncClient", lambda *_a, **_k: FakeAsyncClient())

    with pytest.raises(ServiceError, match="Error creating user"):
        asyncio.run(service.ensure_user_exists("user"))


def test_list_user_servers_missing_token_after_user_check(monkeypatch):
    service = JupyterHubService()
    monkeypatch.delenv("JH_ADMIN_TOKEN", raising=False)
    monkeypatch.setenv("JH_HOST", "http://hub")
    monkeypatch.setattr(service, "ensure_user_exists", AsyncMock())

    with pytest.raises(ServiceError, match="admin token"):
        asyncio.run(service.list_user_servers("user"))


def test_list_user_servers_missing_host_after_user_check(monkeypatch):
    service = JupyterHubService()
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.delenv("JH_HOST", raising=False)
    monkeypatch.setattr(service, "ensure_user_exists", AsyncMock())

    with pytest.raises(ServiceError, match="host not set"):
        asyncio.run(service.list_user_servers("user"))


def test_start_user_server_http_error_on_create(monkeypatch):
    service = JupyterHubService()
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.setenv("JH_HOST", "http://hub")
    monkeypatch.setattr(service, "ensure_user_exists", AsyncMock())

    class FakePostResponse:
        def raise_for_status(self):
            raise _http_status_error("POST", "http://hub", status_code=500)

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *_args, **_kwargs):
            return FakePostResponse()

    monkeypatch.setattr(jupyterhub_module.httpx, "AsyncClient", lambda *_a, **_k: FakeAsyncClient())

    with pytest.raises(ServiceError, match="Error starting a server"):
        asyncio.run(service.start_user_server("user"))


def test_start_user_server_timeout(monkeypatch):
    service = JupyterHubService()
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.setenv("JH_HOST", "http://hub")
    monkeypatch.setattr(service, "ensure_user_exists", AsyncMock())

    class FakePostResponse:
        def raise_for_status(self):
            return None

    class FakePollResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"servers": {}}

    class BaseClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *_args, **_kwargs):
            return FakePostResponse()

    class PollClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, *_args, **_kwargs):
            return FakePollResponse()

    def fake_async_client(*_args, **kwargs):
        if "headers" in kwargs:
            return PollClient()
        return BaseClient()

    class FakeLoop:
        def __init__(self):
            self._times = iter([0.0, 61.0])

        def time(self):
            return next(self._times)

    fake_loop = FakeLoop()

    monkeypatch.setattr(jupyterhub_module.httpx, "AsyncClient", fake_async_client)
    monkeypatch.setattr(jupyterhub_module.asyncio, "get_event_loop", lambda: fake_loop)

    with pytest.raises(ServiceError, match="Timed out waiting for server"):
        asyncio.run(service.start_user_server("user"))


def test_start_user_server_missing_env_after_user_check(monkeypatch):
    service = JupyterHubService()
    monkeypatch.setattr(service, "ensure_user_exists", AsyncMock())

    monkeypatch.delenv("JH_ADMIN_TOKEN", raising=False)
    monkeypatch.setenv("JH_HOST", "http://hub")
    with pytest.raises(ServiceError, match="admin token"):
        asyncio.run(service.start_user_server("user"))

    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.delenv("JH_HOST", raising=False)
    with pytest.raises(ServiceError, match="host not set"):
        asyncio.run(service.start_user_server("user"))


def _install_retirement_transport(monkeypatch, handler):
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        jupyterhub_module.httpx,
        "AsyncClient",
        lambda *args, **kwargs: REAL_ASYNC_CLIENT(*args, transport=transport, **kwargs),
    )


def test_retire_user_access_treats_missing_user_as_success(monkeypatch):
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.setenv("JH_HOST", "http://hub")
    requests = []

    def handler(request):
        requests.append((request.method, request.url.path))
        return httpx.Response(404)

    _install_retirement_transport(monkeypatch, handler)

    asyncio.run(JupyterHubService().retire_user_access("guest@ihub.local"))

    assert requests == [("GET", "/hub/api/users/guest@ihub.local")]


def test_retire_user_access_revokes_tokens_and_waits_for_server(monkeypatch):
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.setenv("JH_HOST", "http://hub")
    requests = []
    user_reads = 0

    def handler(request):
        nonlocal user_reads
        requests.append((request.method, request.url.path))
        if request.method == "GET" and request.url.path.endswith("/tokens"):
            return httpx.Response(200, json={"api_tokens": [{"id": "1"}, {"id": "2"}]})
        if request.method == "GET":
            user_reads += 1
            servers = {"": {"pending": "stop"}} if user_reads < 3 else {}
            return httpx.Response(200, json={"servers": servers})
        return httpx.Response(204)

    _install_retirement_transport(monkeypatch, handler)

    asyncio.run(
        JupyterHubService().retire_user_access(
            "guest@ihub.local",
            poll_interval=0,
        )
    )

    assert ("DELETE", "/hub/api/users/guest@ihub.local/tokens/1") in requests
    assert ("DELETE", "/hub/api/users/guest@ihub.local/tokens/2") in requests
    assert ("DELETE", "/hub/api/users/guest@ihub.local/server") in requests
    assert ("DELETE", "/hub/api/users/guest@ihub.local") not in requests


def test_retire_user_access_is_idempotent_for_stopped_tokenless_user(monkeypatch):
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.setenv("JH_HOST", "http://hub")
    requests = []

    def handler(request):
        requests.append((request.method, request.url.path))
        if request.url.path.endswith("/tokens"):
            return httpx.Response(200, json={"api_tokens": []})
        return httpx.Response(200, json={"servers": {}})

    _install_retirement_transport(monkeypatch, handler)
    service = JupyterHubService()

    asyncio.run(service.retire_user_access("guest@ihub.local"))
    asyncio.run(service.retire_user_access("guest@ihub.local"))

    assert all(method == "GET" for method, _path in requests)


def test_retire_user_access_reports_timeout_and_upstream_failure(monkeypatch):
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.setenv("JH_HOST", "http://hub")

    def running_handler(request):
        if request.url.path.endswith("/tokens"):
            return httpx.Response(200, json={"api_tokens": []})
        if request.method == "DELETE":
            return httpx.Response(202)
        return httpx.Response(200, json={"servers": {"": {"pending": "stop"}}})

    _install_retirement_transport(monkeypatch, running_handler)
    with pytest.raises(ServiceError, match="Timed out"):
        asyncio.run(
            JupyterHubService().retire_user_access(
                "guest@ihub.local",
                stop_timeout=0,
                poll_interval=0,
            )
        )

    def failing_handler(_request):
        return httpx.Response(401)

    _install_retirement_transport(monkeypatch, failing_handler)
    with pytest.raises(ServiceError, match="Failed to retire"):
        asyncio.run(JupyterHubService().retire_user_access("guest@ihub.local"))


def test_retire_user_access_rejects_invalid_user_response(monkeypatch):
    monkeypatch.setenv("JH_ADMIN_TOKEN", "token")
    monkeypatch.setenv("JH_HOST", "http://hub")

    _install_retirement_transport(
        monkeypatch,
        lambda _request: httpx.Response(200, json={"name": "guest@ihub.local"}),
    )

    with pytest.raises(ServiceError, match="invalid user record"):
        asyncio.run(JupyterHubService().retire_user_access("guest@ihub.local"))
