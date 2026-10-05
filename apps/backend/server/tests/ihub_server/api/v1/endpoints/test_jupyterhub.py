from types import SimpleNamespace

import pytest

from ihub_server.api.deps import get_jupyterhub_service, get_principal
from ihub_server.services.errors import ServiceError

ENDPOINTS = (
    ("get", "/api/v1/jupyterhub/{user}/server", "list_user_servers"),
    ("post", "/api/v1/jupyterhub/{user}/server", "start_user_server"),
    ("post", "/api/v1/jupyterhub/{user}/token", "create_user_token"),
)


def _principal(email: str = "user@example.com"):
    return SimpleNamespace(subject_id="subject", email=email)


class FakeJupyterHubService:
    def __init__(self, *, error: bool = False):
        self.calls = []
        self.error = error

    async def _response(self, method: str, user_id: str):
        self.calls.append((method, user_id))
        if self.error:
            raise ServiceError("upstream failed")
        return {"method": method, "user": user_id}

    async def list_user_servers(self, user_id: str):
        return await self._response("list_user_servers", user_id)

    async def start_user_server(self, user_id: str):
        return await self._response("start_user_server", user_id)

    async def create_user_token(self, user_id: str):
        return await self._response("create_user_token", user_id)


@pytest.mark.parametrize(("http_method", "path", "service_method"), ENDPOINTS)
def test_jupyterhub_routes_use_canonical_authenticated_identity(
    client,
    app,
    http_method,
    path,
    service_method,
):
    service = FakeJupyterHubService()
    app.dependency_overrides[get_principal] = lambda: _principal()
    app.dependency_overrides[get_jupyterhub_service] = lambda: service
    try:
        response = getattr(client, http_method)(path.format(user="USER@example.com"))
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {
        "method": service_method,
        "user": "user@example.com",
    }
    assert service.calls == [(service_method, "user@example.com")]


@pytest.mark.parametrize(("http_method", "path", "_service_method"), ENDPOINTS)
def test_jupyterhub_routes_reject_a_different_authenticated_user(
    client,
    app,
    http_method,
    path,
    _service_method,
):
    service = FakeJupyterHubService()
    app.dependency_overrides[get_principal] = lambda: _principal()
    app.dependency_overrides[get_jupyterhub_service] = lambda: service
    try:
        response = getattr(client, http_method)(path.format(user="other@example.com"))
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403
    assert service.calls == []


@pytest.mark.parametrize(("http_method", "path", "_service_method"), ENDPOINTS)
def test_jupyterhub_routes_require_an_ihub_session(
    client,
    app,
    http_method,
    path,
    _service_method,
):
    service = FakeJupyterHubService()
    app.dependency_overrides[get_jupyterhub_service] = lambda: service
    try:
        response = getattr(client, http_method)(path.format(user="user@example.com"))
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 401
    assert service.calls == []


@pytest.mark.parametrize(("http_method", "path", "service_method"), ENDPOINTS)
def test_jupyterhub_routes_preserve_service_error_translation(
    client,
    app,
    http_method,
    path,
    service_method,
):
    service = FakeJupyterHubService(error=True)
    app.dependency_overrides[get_principal] = lambda: _principal()
    app.dependency_overrides[get_jupyterhub_service] = lambda: service
    try:
        response = getattr(client, http_method)(path.format(user="user@example.com"))
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 500
    assert response.json() == {"detail": "upstream failed"}
    assert service.calls == [(service_method, "user@example.com")]
