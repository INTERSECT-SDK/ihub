from uuid import UUID

import pytest

import ihub_server.services.contents as contents_module
from ihub_server.api.deps import (
    Principal,
    get_content_service,
    get_jupyterhub_service,
    get_principal,
    get_project_service,
)
from ihub_server.services.errors import (
    BadRequestError,
    ForbiddenError,
    NotFoundError,
    UnauthorizedError,
    UpstreamServiceError,
)

JUPYTER_PARAMS = {
    "jupyter_user": "user@example.com",
}
JUPYTER_HEADERS = {"Authorization": "Bearer secret-token"}
PROJECT_ID = UUID("11111111-1111-4111-8111-111111111111")
USER_ID = UUID("22222222-2222-4222-8222-222222222222")


@pytest.fixture(autouse=True)
def authorize_default_project_saves(app):
    """Keep existing contents tests focused while save auth is covered explicitly."""

    class FakeProjectService:
        def resolve_user_by_email(self, email):
            assert email == "user@example.com"
            return USER_ID

        def require_edit_access(self, project_id, user_id):
            assert project_id == PROJECT_ID
            assert user_id == USER_ID

    app.dependency_overrides[get_principal] = lambda: Principal(
        subject_id=str(USER_ID),
        email="user@example.com",
    )
    app.dependency_overrides[get_project_service] = lambda: FakeProjectService()
    yield
    app.dependency_overrides.clear()


def test_contents_openapi_uses_jupyter_bearer_auth_only_for_contents_routes(client):
    schema = client.get("/openapi.json").json()

    assert schema["components"]["securitySchemes"]["JupyterBearerAuth"] == {
        "type": "http",
        "description": "Jupyter token forwarded to JupyterHub contents APIs.",
        "scheme": "bearer",
    }

    for path, path_schema in schema["paths"].items():
        for operation in path_schema.values():
            if path.startswith("/api/v1/contents/"):
                assert {"JupyterBearerAuth": []} in operation["security"]
            else:
                assert {"JupyterBearerAuth": []} not in operation.get("security", [])


def test_contents_endpoints_require_jupyter_identity(client):
    assert client.get("/api/v1/contents/read/projects/project-123/demo.ipynb").status_code == 422
    assert (
        client.get(
            "/api/v1/contents/read/projects/project-123/demo.ipynb",
            params={"jupyter_user": "user@example.com"},
        ).status_code
        == 422
    )
    assert (
        client.get(
            "/api/v1/contents/read/projects/project-123/demo.ipynb",
            params=JUPYTER_PARAMS,
            headers={"Authorization": "Basic secret-token"},
        ).status_code
        == 422
    )
    assert (
        client.get(
            "/api/v1/contents/read/projects/project-123/demo.ipynb",
            params={"jupyter_token": "secret-token"},
        ).status_code
        == 422
    )
    assert (
        client.get(
            "/api/v1/contents/read/projects/project-123/demo.ipynb",
            headers=JUPYTER_HEADERS,
        ).status_code
        == 422
    )


def test_read_content_forwards_nested_path_and_query_params(client, app, monkeypatch):
    monkeypatch.delenv("JH_HOST", raising=False)
    captured = {}
    response_model = {
        "name": "demo.ipynb",
        "path": "projects/project-123/notebooks/demo.ipynb",
        "type": "notebook",
        "format": "json",
        "content": {"cells": []},
        "writable": True,
    }

    class FakeContentService:
        async def read_content(
            self,
            base_url,
            path,
            jupyter_user,
            jupyter_token,
            *,
            query=None,
        ):
            captured["base_url"] = base_url
            captured["path"] = path
            captured["jupyter_user"] = jupyter_user
            captured["jupyter_token"] = jupyter_token
            captured["query"] = query
            return response_model

    app.dependency_overrides[get_content_service] = lambda: FakeContentService()
    try:
        response = client.get(
            "/api/v1/contents/read/projects/project-123/notebooks/demo.ipynb",
            params={
                **JUPYTER_PARAMS,
                "jupyter_label": "ignored-label",
                "jupyter_token": "legacy-token",
                "jupyter_server_url": "/ijupyterhub/user/user@example.com",
                "type": "notebook",
                "format": "json",
                "content": "0",
            },
            headers=JUPYTER_HEADERS,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == response_model
    assert captured == {
        "base_url": "http://testserver/ijupyterhub/",
        "path": "projects/project-123/notebooks/demo.ipynb",
        "jupyter_user": "user@example.com",
        "jupyter_token": "secret-token",
        "query": {
            "type": "notebook",
            "format": "json",
            "content": "0",
        },
    }


def test_read_content_resolves_jupyter_token_from_user_email(
    client,
    app,
    monkeypatch,
):
    monkeypatch.delenv("JH_HOST", raising=False)
    captured = {}

    class FakeContentService:
        async def read_content(
            self,
            base_url,
            path,
            jupyter_user,
            jupyter_token,
            *,
            query=None,
        ):
            captured["base_url"] = base_url
            captured["path"] = path
            captured["jupyter_user"] = jupyter_user
            captured["jupyter_token"] = jupyter_token
            captured["query"] = query
            return {"token": jupyter_token}

    class FakeJupyterHubService:
        async def create_user_token_if_exists(self, user_id):
            captured["token_lookup_user_id"] = user_id
            return {"token": "resolved-token"}

    app.dependency_overrides[get_content_service] = lambda: FakeContentService()
    app.dependency_overrides[get_jupyterhub_service] = lambda: FakeJupyterHubService()
    try:
        response = client.get(
            "/api/v1/contents/read/projects/project-123/demo.ipynb",
            params=JUPYTER_PARAMS,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"token": "resolved-token"}
    assert captured == {
        "base_url": "http://testserver/ijupyterhub/",
        "path": "projects/project-123/demo.ipynb",
        "jupyter_user": "user@example.com",
        "jupyter_token": "resolved-token",
        "query": {},
        "token_lookup_user_id": "user@example.com",
    }


def test_read_content_decodes_encoded_jupyter_user_before_service_call(
    client,
    app,
    monkeypatch,
):
    monkeypatch.delenv("JH_HOST", raising=False)
    captured = {}

    class FakeContentService:
        async def read_content(
            self,
            _base_url,
            _path,
            jupyter_user,
            _jupyter_token,
            *,
            query=None,
        ):
            captured["jupyter_user"] = jupyter_user
            return {"jupyter_user": jupyter_user}

    app.dependency_overrides[get_content_service] = lambda: FakeContentService()
    try:
        response = client.get(
            "/api/v1/contents/read/projects/project-123/demo.ipynb",
            params={"jupyter_user": "user%40example.com"},
            headers=JUPYTER_HEADERS,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"jupyter_user": "user@example.com"}
    assert captured == {"jupyter_user": "user@example.com"}


@pytest.mark.parametrize(
    ("route", "method", "params"),
    [
        (
            "/api/v1/contents/save/projects/11111111-1111-4111-8111-111111111111/demo.txt",
            "post",
            {"jupyter_user": "user%40example.com"},
        ),
        (
            "/api/v1/contents/save/projects/11111111-1111-4111-8111-111111111111/demo.txt",
            "put",
            {"jupyter_user": "user%40example.com"},
        ),
        (
            "/api/v1/contents/delete/projects/project-123/demo.txt",
            "delete",
            {
                "jupyter_user": "user%40example.com",
                "jupyter_server_url": "/ijupyterhub/user/user%40example.com",
            },
        ),
        (
            "/api/v1/contents/files/projects/project-123",
            "get",
            {"jupyter_user": "user%40example.com"},
        ),
    ],
)
def test_contents_endpoints_decode_encoded_jupyter_user_before_service_call(
    client,
    app,
    monkeypatch,
    route,
    method,
    params,
):
    monkeypatch.delenv("JH_HOST", raising=False)
    captured = {}

    class FakeContentService:
        async def save_content(
            self,
            _base_url,
            _path,
            _content,
            jupyter_user,
            _jupyter_token,
        ):
            captured["jupyter_user"] = jupyter_user
            return {"jupyter_user": jupyter_user}

        async def delete_content(self, _base_url, _path, jupyter_user, _jupyter_token):
            captured["jupyter_user"] = jupyter_user
            return {"jupyter_user": jupyter_user}

        async def get_files(self, _base_url, _project, jupyter_user, _jupyter_token):
            captured["jupyter_user"] = jupyter_user
            return {"jupyter_user": jupyter_user}

    app.dependency_overrides[get_content_service] = lambda: FakeContentService()
    try:
        request_kwargs = {
            "params": params,
            "headers": JUPYTER_HEADERS,
        }
        if method in {"post", "put"}:
            request_kwargs["json"] = {
                "type": "file",
                "content": "demo",
                "format": "text",
            }
        response = getattr(client, method)(route, **request_kwargs)
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"jupyter_user": "user@example.com"}
    assert captured == {"jupyter_user": "user@example.com"}


@pytest.mark.parametrize(
    "jupyter_user",
    [
        " ",
        "%20",
    ],
)
def test_contents_endpoints_reject_empty_normalized_jupyter_user(
    client,
    app,
    jupyter_user,
):
    class FakeContentService:
        async def read_content(self, *_args, **_kwargs):
            raise AssertionError("service should not be called")

    app.dependency_overrides[get_content_service] = lambda: FakeContentService()
    try:
        response = client.get(
            "/api/v1/contents/read/projects/project-123/demo.ipynb",
            params={"jupyter_user": jupyter_user},
            headers=JUPYTER_HEADERS,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    assert response.json() == {"detail": "Jupyter user is required."}


def test_read_content_ignores_jupyter_token_query_when_header_present(
    client,
    app,
    monkeypatch,
):
    monkeypatch.delenv("JH_HOST", raising=False)
    captured = {}

    class FakeContentService:
        async def read_content(
            self,
            _base_url,
            _path,
            _jupyter_user,
            jupyter_token,
            *,
            query=None,
        ):
            captured["jupyter_token"] = jupyter_token
            return {"token": jupyter_token}

    class FakeJupyterHubService:
        async def create_user_token_if_exists(self, _user_id):
            raise AssertionError("token lookup should not be called")

    app.dependency_overrides[get_content_service] = lambda: FakeContentService()
    app.dependency_overrides[get_jupyterhub_service] = lambda: FakeJupyterHubService()
    try:
        response = client.get(
            "/api/v1/contents/read/projects/project-123/demo.ipynb",
            params={**JUPYTER_PARAMS, "jupyter_token": "legacy-token"},
            headers={"Authorization": "Bearer header-token"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert captured == {"jupyter_token": "header-token"}


@pytest.mark.parametrize(
    "token_payload",
    [
        None,
        {},
        {"token": ""},
    ],
)
def test_read_content_rejects_missing_lookup_token_without_header(
    client,
    app,
    monkeypatch,
    token_payload,
):
    monkeypatch.delenv("JH_HOST", raising=False)

    class FakeContentService:
        async def read_content(self, *_args, **_kwargs):
            raise AssertionError("content service should not be called")

    class FakeJupyterHubService:
        async def create_user_token_if_exists(self, _user_id):
            return token_payload

    app.dependency_overrides[get_content_service] = lambda: FakeContentService()
    app.dependency_overrides[get_jupyterhub_service] = lambda: FakeJupyterHubService()
    try:
        response = client.get(
            "/api/v1/contents/read/projects/project-123/demo.ipynb",
            params={**JUPYTER_PARAMS, "jupyter_token": "legacy-token"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    assert response.json() == {"detail": "Jupyter token is required."}


@pytest.mark.parametrize(
    ("route", "method", "params"),
    [
        (
            "/api/v1/contents/save/projects/11111111-1111-4111-8111-111111111111/demo.txt",
            "post",
            JUPYTER_PARAMS,
        ),
        (
            "/api/v1/contents/delete/projects/project-123/demo.txt",
            "delete",
            {
                **JUPYTER_PARAMS,
                "jupyter_server_url": "/ijupyterhub/user/user@example.com",
            },
        ),
        (
            "/api/v1/contents/files/projects/project-123",
            "get",
            JUPYTER_PARAMS,
        ),
    ],
)
def test_contents_routes_resolve_jupyter_token_from_user_email(
    client,
    app,
    monkeypatch,
    route,
    method,
    params,
):
    monkeypatch.delenv("JH_HOST", raising=False)
    captured = {}

    class FakeContentService:
        async def save_content(
            self,
            _base_url,
            _path,
            _content,
            _jupyter_user,
            jupyter_token,
        ):
            captured["jupyter_token"] = jupyter_token
            return {"token": jupyter_token}

        async def delete_content(self, _base_url, _path, _jupyter_user, jupyter_token):
            captured["jupyter_token"] = jupyter_token
            return {"token": jupyter_token}

        async def get_files(self, _base_url, _project, _jupyter_user, jupyter_token):
            captured["jupyter_token"] = jupyter_token
            return {"token": jupyter_token}

    class FakeJupyterHubService:
        async def create_user_token_if_exists(self, user_id):
            captured["token_lookup_user_id"] = user_id
            return {"token": "resolved-token"}

    app.dependency_overrides[get_content_service] = lambda: FakeContentService()
    app.dependency_overrides[get_jupyterhub_service] = lambda: FakeJupyterHubService()
    try:
        request_kwargs = {"params": params}
        if method == "post":
            request_kwargs["json"] = {
                "type": "file",
                "content": "demo",
                "format": "text",
            }
        response = getattr(client, method)(route, **request_kwargs)
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"token": "resolved-token"}
    assert captured == {
        "jupyter_token": "resolved-token",
        "token_lookup_user_id": "user@example.com",
    }


def test_read_content_prefers_jh_host_over_request_base_url(client, app, monkeypatch):
    monkeypatch.setenv("JH_HOST", "https://ihub.ornl.gov/ijupyterhub")
    captured = {}

    class FakeContentService:
        async def read_content(
            self,
            base_url,
            path,
            jupyter_user,
            jupyter_token,
            *,
            query=None,
        ):
            captured["base_url"] = base_url
            captured["path"] = path
            captured["jupyter_user"] = jupyter_user
            captured["jupyter_token"] = jupyter_token
            captured["query"] = query
            return {"path": path}

    app.dependency_overrides[get_content_service] = lambda: FakeContentService()
    try:
        response = client.get(
            "/api/v1/contents/read/projects/project-123/demo.ipynb",
            params=JUPYTER_PARAMS,
            headers=JUPYTER_HEADERS,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert captured == {
        "base_url": "https://ihub.ornl.gov/ijupyterhub",
        "path": "projects/project-123/demo.ipynb",
        "jupyter_user": "user@example.com",
        "jupyter_token": "secret-token",
        "query": {},
    }


@pytest.mark.parametrize("method", ["post", "put"])
def test_save_content_passes_jupyter_compatible_request_body(
    client,
    app,
    monkeypatch,
    method,
):
    monkeypatch.delenv("JH_HOST", raising=False)
    captured = {}
    payload = {
        "type": "file",
        "content": {"enabled": True},
        "format": "text",
        "path": "projects/11111111-1111-4111-8111-111111111111/nested/config.json",
        "name": "config.json",
    }

    class FakeContentService:
        async def save_content(
            self,
            base_url,
            path,
            content,
            jupyter_user,
            jupyter_token,
        ):
            captured["base_url"] = base_url
            captured["path"] = path
            captured["content"] = content
            captured["jupyter_user"] = jupyter_user
            captured["jupyter_token"] = jupyter_token
            return payload

    app.dependency_overrides[get_content_service] = lambda: FakeContentService()
    try:
        response = getattr(client, method)(
            "/api/v1/contents/save/projects/11111111-1111-4111-8111-111111111111/nested/config.json",
            params=JUPYTER_PARAMS,
            headers=JUPYTER_HEADERS,
            json=payload,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == payload
    assert captured == {
        "base_url": "http://testserver/ijupyterhub/",
        "path": "projects/11111111-1111-4111-8111-111111111111/nested/config.json",
        "content": payload,
        "jupyter_user": "user@example.com",
        "jupyter_token": "secret-token",
    }


def test_contents_endpoints_reject_traversal_paths_before_upstream_request(
    client,
    monkeypatch,
):
    async_client_calls = 0

    def fail_async_client():
        nonlocal async_client_calls
        async_client_calls += 1
        raise AssertionError("upstream request should not be attempted")

    monkeypatch.setattr(contents_module.httpx, "AsyncClient", fail_async_client)

    read_response = client.get(
        "/api/v1/contents/read/%2E%2E/%2E%2E/api/status",
        params=JUPYTER_PARAMS,
        headers=JUPYTER_HEADERS,
    )
    save_response = client.post(
        "/api/v1/contents/save/%2E%2E/%2E%2E/api/status",
        params=JUPYTER_PARAMS,
        headers=JUPYTER_HEADERS,
        json={"type": "file", "content": "demo", "format": "text"},
    )
    save_put_response = client.put(
        "/api/v1/contents/save/%2E%2E/%2E%2E/api/status",
        params=JUPYTER_PARAMS,
        headers=JUPYTER_HEADERS,
        json={"type": "file", "content": "demo", "format": "text"},
    )
    delete_response = client.delete(
        "/api/v1/contents/delete/%2E%2E/%2E%2E/api/status",
        params=JUPYTER_PARAMS,
        headers=JUPYTER_HEADERS,
    )

    assert read_response.status_code == 400
    assert save_response.status_code == 400
    assert save_put_response.status_code == 400
    assert delete_response.status_code == 400
    assert read_response.json() == {
        "detail": "Invalid contents path: absolute paths and dot segments are not allowed."
    }
    assert save_response.json() == {
        "detail": "Invalid contents path: absolute paths and dot segments are not allowed."
    }
    assert save_put_response.json() == {
        "detail": "Invalid contents path: absolute paths and dot segments are not allowed."
    }
    assert delete_response.json() == {
        "detail": "Invalid contents path: absolute paths and dot segments are not allowed."
    }
    assert async_client_calls == 0


def test_delete_content_returns_upstream_response(client, app, monkeypatch):
    monkeypatch.delenv("JH_HOST", raising=False)
    captured = {}
    upstream_response = {"message": "deleted"}

    class FakeContentService:
        async def delete_content(self, base_url, path, jupyter_user, jupyter_token):
            captured["base_url"] = base_url
            captured["path"] = path
            captured["jupyter_user"] = jupyter_user
            captured["jupyter_token"] = jupyter_token
            return upstream_response

    app.dependency_overrides[get_content_service] = lambda: FakeContentService()
    try:
        response = client.delete(
            "/api/v1/contents/delete/projects/project-123/demo.ipynb",
            params=JUPYTER_PARAMS,
            headers=JUPYTER_HEADERS,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == upstream_response
    assert captured == {
        "base_url": "http://testserver/ijupyterhub/",
        "path": "projects/project-123/demo.ipynb",
        "jupyter_user": "user@example.com",
        "jupyter_token": "secret-token",
    }


def test_delete_content_uses_jupyter_server_url_routing_hint(client, app, monkeypatch):
    monkeypatch.delenv("JH_HOST", raising=False)
    captured = {}
    upstream_response = {"message": "deleted"}

    class FakeContentService:
        async def delete_content(self, base_url, path, jupyter_user, jupyter_token):
            captured["base_url"] = base_url
            captured["path"] = path
            captured["jupyter_user"] = jupyter_user
            captured["jupyter_token"] = jupyter_token
            return upstream_response

    app.dependency_overrides[get_content_service] = lambda: FakeContentService()
    try:
        response = client.delete(
            "/api/v1/contents/delete/projects/project-123/demo.ipynb",
            params={
                **JUPYTER_PARAMS,
                "jupyter_server_url": "/ijupyterhub/user/user@example.com",
            },
            headers=JUPYTER_HEADERS,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == upstream_response
    assert captured == {
        "base_url": "http://testserver/ijupyterhub/user/user@example.com",
        "path": "projects/project-123/demo.ipynb",
        "jupyter_user": "user@example.com",
        "jupyter_token": "secret-token",
    }


def test_delete_content_prefers_jh_host_over_jupyter_server_url_routing_hint(
    client,
    app,
    monkeypatch,
):
    monkeypatch.setenv("JH_HOST", "https://ihub.ornl.gov/ijupyterhub")
    captured = {}
    upstream_response = {"message": "deleted"}

    class FakeContentService:
        async def delete_content(self, base_url, path, jupyter_user, jupyter_token):
            captured["base_url"] = base_url
            captured["path"] = path
            captured["jupyter_user"] = jupyter_user
            captured["jupyter_token"] = jupyter_token
            return upstream_response

    app.dependency_overrides[get_content_service] = lambda: FakeContentService()
    try:
        response = client.delete(
            "/api/v1/contents/delete/projects/project-123/demo.ipynb",
            params={
                **JUPYTER_PARAMS,
                "jupyter_server_url": "/ijupyterhub/user/user@example.com",
            },
            headers=JUPYTER_HEADERS,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == upstream_response
    assert captured == {
        "base_url": "https://ihub.ornl.gov/ijupyterhub/user/user@example.com",
        "path": "projects/project-123/demo.ipynb",
        "jupyter_user": "user@example.com",
        "jupyter_token": "secret-token",
    }


def test_delete_content_preserves_named_server_hint_with_jh_host(
    client,
    app,
    monkeypatch,
):
    monkeypatch.setenv("JH_HOST", "http://jupyterhub:8000")
    captured = {}
    upstream_response = {"message": "deleted"}

    class FakeContentService:
        async def delete_content(self, base_url, path, jupyter_user, jupyter_token):
            captured["base_url"] = base_url
            captured["path"] = path
            captured["jupyter_user"] = jupyter_user
            captured["jupyter_token"] = jupyter_token
            return upstream_response

    app.dependency_overrides[get_content_service] = lambda: FakeContentService()
    try:
        response = client.delete(
            "/api/v1/contents/delete/projects/project-123/demo.ipynb",
            params={
                **JUPYTER_PARAMS,
                "jupyter_server_url": "/ijupyterhub/user/user@example.com/lab-server",
            },
            headers=JUPYTER_HEADERS,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == upstream_response
    assert captured == {
        "base_url": "http://jupyterhub:8000/user/user@example.com/lab-server",
        "path": "projects/project-123/demo.ipynb",
        "jupyter_user": "user@example.com",
        "jupyter_token": "secret-token",
    }


def test_get_files_returns_full_directory_model_for_nested_project_path(
    client,
    app,
    monkeypatch,
):
    monkeypatch.delenv("JH_HOST", raising=False)
    captured = {}
    directory_model = {
        "name": "project-123",
        "path": "projects/project-123/folder",
        "type": "directory",
        "format": "json",
        "content": [
            {
                "name": "demo.ipynb",
                "path": "projects/project-123/folder/demo.ipynb",
                "type": "notebook",
            }
        ],
    }

    class FakeContentService:
        async def get_files(self, base_url, project, jupyter_user, jupyter_token):
            captured["base_url"] = base_url
            captured["project"] = project
            captured["jupyter_user"] = jupyter_user
            captured["jupyter_token"] = jupyter_token
            return directory_model

    app.dependency_overrides[get_content_service] = lambda: FakeContentService()
    try:
        response = client.get(
            "/api/v1/contents/files/projects/project-123/folder",
            params=JUPYTER_PARAMS,
            headers=JUPYTER_HEADERS,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == directory_model
    assert captured == {
        "base_url": "http://testserver/ijupyterhub/",
        "project": "projects/project-123/folder",
        "jupyter_user": "user@example.com",
        "jupyter_token": "secret-token",
    }


def test_read_content_translates_service_errors_to_http_status_codes(client, app):
    class FakeContentService:
        async def read_content(
            self,
            _base_url,
            path,
            _jupyter_user,
            _jupyter_token,
            *,
            query=None,
        ):
            if path.endswith("bad-request.txt"):
                raise BadRequestError("invalid request")
            if path.endswith("unauthorized.txt"):
                raise UnauthorizedError("unauthorized")
            if path.endswith("forbidden.txt"):
                raise ForbiddenError("forbidden")
            if path.endswith("missing.txt"):
                raise NotFoundError("missing")
            raise UpstreamServiceError("upstream failed", status_code=503)

    app.dependency_overrides[get_content_service] = lambda: FakeContentService()
    try:
        assert (
            client.get(
                "/api/v1/contents/read/projects/project-123/bad-request.txt",
                params=JUPYTER_PARAMS,
                headers=JUPYTER_HEADERS,
            ).status_code
            == 400
        )
        assert (
            client.get(
                "/api/v1/contents/read/projects/project-123/unauthorized.txt",
                params=JUPYTER_PARAMS,
                headers=JUPYTER_HEADERS,
            ).status_code
            == 401
        )
        assert (
            client.get(
                "/api/v1/contents/read/projects/project-123/forbidden.txt",
                params=JUPYTER_PARAMS,
                headers=JUPYTER_HEADERS,
            ).status_code
            == 403
        )
        assert (
            client.get(
                "/api/v1/contents/read/projects/project-123/missing.txt",
                params=JUPYTER_PARAMS,
                headers=JUPYTER_HEADERS,
            ).status_code
            == 404
        )
        response = client.get(
            "/api/v1/contents/read/projects/project-123/upstream.txt",
            params=JUPYTER_PARAMS,
            headers=JUPYTER_HEADERS,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json() == {"detail": "upstream failed"}


def test_download_content_streams_binary_body_and_attachment_metadata(
    client,
    app,
    monkeypatch,
):
    monkeypatch.delenv("JH_HOST", raising=False)
    captured = {}

    class FakeFileStream:
        content_type = "application/x-custom"
        content_length = "5"

        def __init__(self):
            self.closed = False

        async def iter_raw(self):
            yield b"\x00\xff"
            yield b"raw"

        async def aclose(self):
            self.closed = True

    stream = FakeFileStream()

    class FakeContentService:
        async def stream_file(
            self,
            base_url,
            path,
            jupyter_user,
            jupyter_token,
        ):
            captured.update(
                base_url=base_url,
                path=path,
                jupyter_user=jupyter_user,
                jupyter_token=jupyter_token,
            )
            return stream

    class FakeJupyterHubService:
        async def create_user_token_if_exists(self, user_id):
            captured["token_lookup_user_id"] = user_id
            return {"token": "resolved-token"}

    app.dependency_overrides[get_principal] = lambda: Principal(
        subject_id="user-1",
        email="user@example.com",
    )
    app.dependency_overrides[get_content_service] = lambda: FakeContentService()
    app.dependency_overrides[get_jupyterhub_service] = lambda: FakeJupyterHubService()
    try:
        response = client.get(
            "/api/v1/contents/download/projects/project-123/data.bin",
            params={
                "jupyter_user": "USER@example.com",
                "jupyter_server_url": "/ijupyterhub/user/user@example.com/lab-server",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.content == b"\x00\xffraw"
    assert response.headers["content-type"] == "application/x-custom"
    assert response.headers["content-length"] == "5"
    assert response.headers["content-disposition"] == (
        "attachment; filename=\"data.bin\"; filename*=UTF-8''data.bin"
    )
    assert captured == {
        "base_url": "http://testserver/ijupyterhub/user/user@example.com/lab-server",
        "path": "projects/project-123/data.bin",
        "jupyter_user": "user@example.com",
        "jupyter_token": "resolved-token",
        "token_lookup_user_id": "user@example.com",
    }
    assert stream.closed is True


def test_download_content_forwards_authorization_without_token_lookup(
    client,
    app,
    monkeypatch,
):
    monkeypatch.delenv("JH_HOST", raising=False)
    captured = {}

    class FakeFileStream:
        content_type = "application/octet-stream"
        content_length = None

        async def iter_raw(self):
            yield b"download"

        async def aclose(self):
            return None

    class FakeContentService:
        async def stream_file(
            self,
            base_url,
            path,
            jupyter_user,
            jupyter_token,
        ):
            captured.update(
                base_url=base_url,
                path=path,
                jupyter_user=jupyter_user,
                jupyter_token=jupyter_token,
            )
            return FakeFileStream()

    class UnexpectedJupyterHubService:
        async def create_user_token_if_exists(self, _user_id):
            raise AssertionError("token lookup should not be attempted")

    app.dependency_overrides[get_principal] = lambda: Principal(
        subject_id="user-1",
        email="user@example.com",
    )
    app.dependency_overrides[get_content_service] = lambda: FakeContentService()
    app.dependency_overrides[get_jupyterhub_service] = lambda: UnexpectedJupyterHubService()
    try:
        response = client.get(
            "/api/v1/contents/download/projects/project-123/data.bin",
            params={
                "jupyter_user": "user@example.com",
                "jupyter_server_url": "/ijupyterhub/user/user@example.com/lab-server",
            },
            headers=JUPYTER_HEADERS,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.content == b"download"
    assert captured == {
        "base_url": "http://testserver/ijupyterhub/user/user@example.com/lab-server",
        "path": "projects/project-123/data.bin",
        "jupyter_user": "user@example.com",
        "jupyter_token": "secret-token",
    }


def test_download_content_uses_unicode_filename_metadata(client, app):
    class FakeFileStream:
        content_type = None
        content_length = None

        async def iter_raw(self):
            yield b"text"

        async def aclose(self):
            return None

    class FakeContentService:
        async def stream_file(self, *_args):
            return FakeFileStream()

    app.dependency_overrides[get_principal] = lambda: Principal(
        subject_id="user-1",
        email="user@example.com",
    )
    app.dependency_overrides[get_content_service] = lambda: FakeContentService()
    try:
        response = client.get(
            "/api/v1/contents/download/projects/project-123/%E6%96%87%E4%BB%B6.txt",
            params=JUPYTER_PARAMS,
            headers=JUPYTER_HEADERS,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["content-disposition"] == (
        "attachment; filename=\"__.txt\"; filename*=UTF-8''%E6%96%87%E4%BB%B6.txt"
    )


def test_download_content_rejects_identity_mismatch_before_token_lookup(client, app):
    class UnexpectedJupyterHubService:
        async def create_user_token_if_exists(self, _user_id):
            raise AssertionError("token lookup should not be attempted")

    class UnexpectedContentService:
        async def stream_file(self, *_args):
            raise AssertionError("upstream request should not be attempted")

    app.dependency_overrides[get_principal] = lambda: Principal(
        subject_id="user-1",
        email="user@example.com",
    )
    app.dependency_overrides[get_jupyterhub_service] = lambda: UnexpectedJupyterHubService()
    app.dependency_overrides[get_content_service] = lambda: UnexpectedContentService()
    try:
        response = client.get(
            "/api/v1/contents/download/projects/project-123/private.txt",
            params={"jupyter_user": "other@example.com"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403
    assert response.json() == {"detail": "Jupyter user must match authenticated user."}


def test_download_content_requires_authenticated_ihub_principal(client, app):
    app.dependency_overrides.pop(get_principal)
    response = client.get(
        "/api/v1/contents/download/projects/project-123/private.txt",
        params=JUPYTER_PARAMS,
        headers=JUPYTER_HEADERS,
    )

    assert response.status_code == 401


def test_download_content_rejects_traversal_before_upstream_request(
    client,
    app,
    monkeypatch,
):
    def fail_async_client():
        raise AssertionError("upstream request should not be attempted")

    monkeypatch.setattr(contents_module.httpx, "AsyncClient", fail_async_client)
    app.dependency_overrides[get_principal] = lambda: Principal(
        subject_id="user-1",
        email="user@example.com",
    )
    try:
        response = client.get(
            "/api/v1/contents/download/%2E%2E/%2E%2E/api/status",
            params=JUPYTER_PARAMS,
            headers=JUPYTER_HEADERS,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    assert response.json() == {
        "detail": "Invalid contents path: absolute paths and dot segments are not allowed."
    }


@pytest.mark.parametrize(
    ("error", "status_code"),
    [
        (BadRequestError("unsafe"), 400),
        (UnauthorizedError("unauthorized"), 401),
        (ForbiddenError("forbidden"), 403),
        (NotFoundError("missing"), 404),
        (UpstreamServiceError("upstream", status_code=502), 502),
    ],
)
def test_download_content_translates_service_errors(client, app, error, status_code):
    class FakeContentService:
        async def stream_file(self, *_args):
            raise error

    app.dependency_overrides[get_principal] = lambda: Principal(
        subject_id="user-1",
        email="user@example.com",
    )
    app.dependency_overrides[get_content_service] = lambda: FakeContentService()
    try:
        response = client.get(
            "/api/v1/contents/download/projects/project-123/file.bin",
            params=JUPYTER_PARAMS,
            headers=JUPYTER_HEADERS,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == status_code
