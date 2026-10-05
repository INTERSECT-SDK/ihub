import base64
import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from uuid import UUID

import pytest

import ihub_server.api.v1.endpoints.contents as contents_endpoint
from ihub_server.api.deps import (
    Principal,
    get_content_service,
    get_project_service,
)
from ihub_server.services.errors import ForbiddenError, NotFoundError, UpstreamServiceError

PROJECT_ID = UUID("11111111-1111-4111-8111-111111111111")
USER_ID = UUID("22222222-2222-4222-8222-222222222222")
SAVE_PATH = f"projects/{PROJECT_ID}/nested/data.json"
SAVE_URL = f"/api/v1/contents/save/{SAVE_PATH}"
PARAMS = {"jupyter_user": "user@example.com"}
HEADERS = {"Authorization": "Bearer exact-jupyter-token"}


class EditableProjectService:
    def __init__(self, error=None):
        self.error = error
        self.calls = []

    def resolve_user_by_email(self, email):
        self.calls.append(("resolve", email))
        return USER_ID

    def require_edit_access(self, project_id, user_id):
        self.calls.append(("authorize", project_id, user_id))
        if self.error:
            raise self.error


class UploadContentService:
    def __init__(self, *, exists=False, read_error=None, save_error=None):
        self.exists = exists
        self.read_error = read_error
        self.save_error = save_error
        self.read_calls = []
        self.save_calls = []

    async def read_content(
        self,
        base_url,
        path,
        jupyter_user,
        jupyter_token,
        *,
        query=None,
    ):
        self.read_calls.append((base_url, path, jupyter_user, jupyter_token, query))
        if self.read_error:
            raise self.read_error
        if not self.exists:
            raise NotFoundError("missing")
        return {"name": "data.json", "content": None}

    async def save_content(
        self,
        base_url,
        path,
        content,
        jupyter_user,
        jupyter_token,
    ):
        self.save_calls.append((base_url, path, content, jupyter_user, jupyter_token))
        if self.save_error:
            raise self.save_error
        return {"path": path}


class ConcurrentUploadContentService(UploadContentService):
    def __init__(self, blocked_path=SAVE_PATH):
        super().__init__()
        self.blocked_path = blocked_path
        self.existing_paths = set()
        self.first_save_started = Event()
        self.release_first_save = Event()
        self.other_save_started = Event()
        self.operation_calls = []
        self._state_lock = Lock()

    async def read_content(
        self,
        base_url,
        path,
        jupyter_user,
        jupyter_token,
        *,
        query=None,
    ):
        self.read_calls.append((base_url, path, jupyter_user, jupyter_token, query))
        with self._state_lock:
            self.operation_calls.append(("read", base_url, path))
            exists = path in self.existing_paths
        if not exists:
            raise NotFoundError("missing")
        return {"path": path, "content": None}

    async def save_content(
        self,
        base_url,
        path,
        content,
        jupyter_user,
        jupyter_token,
    ):
        self.save_calls.append((base_url, path, content, jupyter_user, jupyter_token))
        with self._state_lock:
            self.operation_calls.append(("save_started", base_url, path))
        if path == self.blocked_path and not self.first_save_started.is_set():
            self.first_save_started.set()
            while not self.release_first_save.is_set():
                await asyncio.sleep(0.001)
        else:
            self.other_save_started.set()

        with self._state_lock:
            self.existing_paths.add(path)
            self.operation_calls.append(("save_completed", base_url, path))
        return {"path": path}


class ConcurrentProjectService(EditableProjectService):
    def __init__(self):
        super().__init__()
        self.second_authorization_started = Event()
        self._authorization_count = 0
        self._authorization_lock = Lock()

    def require_edit_access(self, project_id, user_id):
        super().require_edit_access(project_id, user_id)
        with self._authorization_lock:
            self._authorization_count += 1
            if self._authorization_count == 2:
                self.second_authorization_started.set()


def upload_payload(raw=b"\x00\xffbinary"):
    return {
        "type": "file",
        "format": "base64",
        "content": base64.b64encode(raw).decode("ascii"),
    }


def configure_upload_dependencies(
    app,
    content_service,
    project_service,
    *,
    principal=None,
):
    session_principal = principal or Principal(
        subject_id=str(USER_ID),
        email="user@example.com",
    )
    app.dependency_overrides[contents_endpoint.get_upload_user] = lambda: {
        "subject_id": session_principal.subject_id,
        "email": session_principal.email,
        "role": "user",
    }
    app.dependency_overrides[get_content_service] = lambda: content_service
    app.dependency_overrides[get_project_service] = lambda: project_service


def test_upload_policy_returns_supported_extensions_and_configured_limit(client, monkeypatch):
    monkeypatch.setattr(contents_endpoint, "PROJECT_FILE_UPLOAD_MAX_BYTES", 1234)

    response = client.get("/api/v1/contents/upload-policy")

    assert response.status_code == 200
    assert response.json() == {
        "supported_extensions": [
            ".icmp",
            ".ipynb",
            ".ichat",
            ".ivis",
            ".txt",
            ".json",
        ],
        "max_file_size_bytes": 1234,
    }


def test_base64_upload_authorizes_checks_metadata_and_forwards_payload_unchanged(
    client,
    app,
    monkeypatch,
):
    monkeypatch.delenv("JH_HOST", raising=False)
    payload = upload_payload()
    content_service = UploadContentService()
    project_service = EditableProjectService()
    configure_upload_dependencies(app, content_service, project_service)
    try:
        response = client.put(
            SAVE_URL,
            params={
                "jupyter_user": "USER@EXAMPLE.COM",
                "jupyter_server_url": "/ijupyterhub/user/user@example.com",
            },
            headers=HEADERS,
            json=payload,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert project_service.calls == [
        ("resolve", "user@example.com"),
        ("authorize", PROJECT_ID, USER_ID),
    ]
    assert content_service.read_calls == [
        (
            "http://testserver/ijupyterhub/user/user@example.com",
            SAVE_PATH,
            "user@example.com",
            "exact-jupyter-token",
            {"content": "0"},
        )
    ]
    assert content_service.save_calls == [
        (
            "http://testserver/ijupyterhub/user/user@example.com",
            SAVE_PATH,
            payload,
            "user@example.com",
            "exact-jupyter-token",
        )
    ]


@pytest.mark.parametrize("method", ["post", "put"])
def test_text_save_skips_project_authorization_and_forwards_payload_unchanged(
    client,
    app,
    monkeypatch,
    method,
):
    payload = {
        "type": "file",
        "format": "text",
        "content": "ordinary Jupyter contents save",
    }
    path = "notebooks/ordinary.txt"
    content_service = UploadContentService()
    redis_accesses = 0

    def fail_redis_access():
        nonlocal redis_accesses
        redis_accesses += 1
        raise AssertionError("text saves must not access Redis")

    class FailingProjectService:
        def resolve_user_by_email(self, _email):
            raise AssertionError("text saves must not resolve a project user")

        def require_edit_access(self, _project_id, _user_id):
            raise AssertionError("text saves must not authorize project access")

    monkeypatch.setattr(app.state.redis, "json", fail_redis_access)
    app.dependency_overrides[get_content_service] = lambda: content_service
    app.dependency_overrides[get_project_service] = lambda: FailingProjectService()
    client.cookies.set("IHUB_SESSION", "ordinary-save-session")
    try:
        response = getattr(client, method)(
            f"/api/v1/contents/save/{path}",
            params=PARAMS,
            headers=HEADERS,
            json=payload,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"path": path}
    assert redis_accesses == 0
    assert content_service.read_calls == []
    assert content_service.save_calls == [
        (
            "http://testserver/ijupyterhub/",
            path,
            payload,
            "user@example.com",
            "exact-jupyter-token",
        )
    ]


@pytest.mark.parametrize("method", ["post", "put"])
def test_text_save_skips_project_authorization_and_forwards_to_user_server(
    client,
    app,
    method,
):
    payload = {
        "type": "file",
        "format": "text",
        "content": "Jupyter contents save",
    }
    path = "notebooks/user-notebook.txt"
    content_service = UploadContentService()

    class FailingProjectService:
        def resolve_user_by_email(self, _email):
            raise AssertionError("text saves must not resolve a project user")

        def require_edit_access(self, _project_id, _user_id):
            raise AssertionError("text saves must not authorize project access")

    configure_upload_dependencies(
        app,
        content_service,
        FailingProjectService(),
        principal=Principal(
            subject_id=str(USER_ID),
            email="user@example.com",
        ),
    )
    try:
        response = getattr(client, method)(
            f"/api/v1/contents/save/{path}",
            params={"jupyter_user": "user@example.com"},
            headers=HEADERS,
            json=payload,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"path": path}
    assert content_service.read_calls == []
    assert content_service.save_calls == [
        (
            "http://testserver/ijupyterhub/",
            path,
            payload,
            "user@example.com",
            "exact-jupyter-token",
        )
    ]


def test_existing_base64_upload_conflicts_without_forwarding_save(client, app):
    content_service = UploadContentService(exists=True)
    configure_upload_dependencies(app, content_service, EditableProjectService())
    try:
        response = client.put(SAVE_URL, params=PARAMS, headers=HEADERS, json=upload_payload())
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 409
    assert response.json() == {"detail": "A file with this name already exists."}
    assert len(content_service.read_calls) == 1
    assert content_service.save_calls == []


def test_confirmed_overwrite_skips_metadata_check_and_saves(client, app):
    payload = upload_payload()
    content_service = UploadContentService(exists=True)
    configure_upload_dependencies(app, content_service, EditableProjectService())
    try:
        response = client.put(
            SAVE_URL,
            params={**PARAMS, "overwrite": "true"},
            headers=HEADERS,
            json=payload,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert content_service.read_calls == []
    assert content_service.save_calls[0][2] == payload


def test_simultaneous_no_overwrite_uploads_to_same_target_are_serialized(client, app):
    content_service = ConcurrentUploadContentService()
    project_service = ConcurrentProjectService()
    configure_upload_dependencies(app, content_service, project_service)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            first_response = executor.submit(
                client.put,
                SAVE_URL,
                params=PARAMS,
                headers=HEADERS,
                json=upload_payload(b"first"),
            )
            assert content_service.first_save_started.wait(timeout=2)

            second_response = executor.submit(
                client.put,
                SAVE_URL,
                params=PARAMS,
                headers=HEADERS,
                json=upload_payload(b"second"),
            )
            assert project_service.second_authorization_started.wait(timeout=2)
            content_service.release_first_save.set()

            responses = [first_response.result(timeout=2), second_response.result(timeout=2)]
    finally:
        content_service.release_first_save.set()
        app.dependency_overrides.clear()

    assert sorted(response.status_code for response in responses) == [200, 409]
    assert len(content_service.save_calls) == 1
    assert len(content_service.read_calls) == 2
    assert app.state.upload_lock_manager.active_lock_count == 0


def test_hub_root_and_default_user_server_uploads_share_a_lock(
    client,
    app,
    monkeypatch,
):
    monkeypatch.delenv("JH_HOST", raising=False)
    content_service = ConcurrentUploadContentService()
    project_service = ConcurrentProjectService()
    configure_upload_dependencies(app, content_service, project_service)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            first_response = executor.submit(
                client.put,
                SAVE_URL,
                params=PARAMS,
                headers=HEADERS,
                json=upload_payload(b"first"),
            )
            assert content_service.first_save_started.wait(timeout=2)

            second_response = executor.submit(
                client.put,
                SAVE_URL,
                params={
                    **PARAMS,
                    "jupyter_server_url": "/ijupyterhub/user/user@example.com",
                },
                headers=HEADERS,
                json=upload_payload(b"second"),
            )
            assert project_service.second_authorization_started.wait(timeout=2)
            content_service.release_first_save.set()

            responses = [first_response.result(timeout=2), second_response.result(timeout=2)]
    finally:
        content_service.release_first_save.set()
        app.dependency_overrides.clear()

    root_base_url = "http://testserver/ijupyterhub/"
    user_base_url = "http://testserver/ijupyterhub/user/user@example.com"
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert len(content_service.save_calls) == 1
    assert content_service.operation_calls == [
        ("read", root_base_url, SAVE_PATH),
        ("save_started", root_base_url, SAVE_PATH),
        ("save_completed", root_base_url, SAVE_PATH),
        ("read", user_base_url, SAVE_PATH),
    ]
    assert app.state.upload_lock_manager.active_lock_count == 0


def test_uploads_to_different_targets_are_not_globally_serialized(client, app):
    other_path = f"projects/{PROJECT_ID}/nested/other.json"
    other_url = f"/api/v1/contents/save/{other_path}"
    content_service = ConcurrentUploadContentService()
    configure_upload_dependencies(app, content_service, EditableProjectService())
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            first_response = executor.submit(
                client.put,
                SAVE_URL,
                params={**PARAMS, "overwrite": "true"},
                headers=HEADERS,
                json=upload_payload(b"first"),
            )
            assert content_service.first_save_started.wait(timeout=2)

            second_response = executor.submit(
                client.put,
                other_url,
                params={**PARAMS, "overwrite": "true"},
                headers=HEADERS,
                json=upload_payload(b"second"),
            )
            assert content_service.other_save_started.wait(timeout=2)
            content_service.release_first_save.set()

            responses = [first_response.result(timeout=2), second_response.result(timeout=2)]
    finally:
        content_service.release_first_save.set()
        app.dependency_overrides.clear()

    assert [response.status_code for response in responses] == [200, 200]
    assert {call[1] for call in content_service.save_calls} == {SAVE_PATH, other_path}
    assert app.state.upload_lock_manager.active_lock_count == 0


@pytest.mark.parametrize(
    ("path", "payload", "detail"),
    [
        (
            "not-project/data.json",
            upload_payload(),
            "Save path must be projects/{project_uuid}/{file_path}.",
        ),
        (
            "projects/not-a-uuid/data.json",
            upload_payload(),
            "Save path contains an invalid project UUID.",
        ),
        (
            f"projects/{str(PROJECT_ID).replace('-', '')}/data.json",
            upload_payload(),
            "Save path contains an invalid project UUID.",
        ),
        (
            f"projects/{PROJECT_ID}/.json",
            upload_payload(),
            "Invalid upload filename.",
        ),
        (
            f"projects/{PROJECT_ID}/data.csv",
            upload_payload(),
            "Unsupported file extension. Supported extensions: ",
        ),
        (
            SAVE_PATH,
            {"type": "directory", "format": "base64", "content": "AA=="},
            "Base64 uploads must use type 'file'.",
        ),
        (
            SAVE_PATH,
            {"type": "file", "format": "base64", "content": 12},
            "Base64 upload content must be a string.",
        ),
        (
            SAVE_PATH,
            {"type": "file", "format": "base64", "content": "not base64!"},
            "Upload content is not valid base64.",
        ),
    ],
)
def test_base64_upload_rejects_invalid_requests(client, app, path, payload, detail):
    content_service = UploadContentService()
    configure_upload_dependencies(app, content_service, EditableProjectService())
    try:
        response = client.put(
            f"/api/v1/contents/save/{path}",
            params=PARAMS,
            headers=HEADERS,
            json=payload,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    assert response.json()["detail"].startswith(detail)
    assert content_service.read_calls == []
    assert content_service.save_calls == []


def test_base64_upload_accepts_exact_limit_and_rejects_oversized_content(
    client,
    app,
    monkeypatch,
):
    monkeypatch.setattr(contents_endpoint, "PROJECT_FILE_UPLOAD_MAX_BYTES", 3)
    content_service = UploadContentService()
    configure_upload_dependencies(app, content_service, EditableProjectService())
    try:
        exact_response = client.put(
            SAVE_URL,
            params=PARAMS,
            headers=HEADERS,
            json=upload_payload(b"123"),
        )
        oversized_response = client.put(
            SAVE_URL,
            params=PARAMS,
            headers=HEADERS,
            json=upload_payload(b"1234"),
        )
    finally:
        app.dependency_overrides.clear()

    assert exact_response.status_code == 200
    assert oversized_response.status_code == 400
    assert oversized_response.json() == {"detail": "Upload exceeds the 3-byte file size limit."}


@pytest.mark.parametrize(
    ("principal", "project_error", "status_code", "detail"),
    [
        (
            Principal(subject_id="other", email="other@example.com"),
            None,
            403,
            "Jupyter user must match authenticated user.",
        ),
        (
            None,
            ForbiddenError("Edit access to this project is required."),
            403,
            "Edit access to this project is required.",
        ),
        (
            None,
            NotFoundError("Project not found."),
            404,
            "Project not found.",
        ),
    ],
)
def test_base64_upload_denies_unauthorized_callers(
    client,
    app,
    principal,
    project_error,
    status_code,
    detail,
):
    content_service = UploadContentService()
    configure_upload_dependencies(
        app,
        content_service,
        EditableProjectService(project_error),
        principal=principal,
    )
    try:
        response = client.put(SAVE_URL, params=PARAMS, headers=HEADERS, json=upload_payload())
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == status_code
    assert response.json() == {"detail": detail}
    assert content_service.read_calls == []
    assert content_service.save_calls == []


def test_base64_upload_requires_authenticated_principal(client, app):
    content_service = UploadContentService()
    configure_upload_dependencies(app, content_service, EditableProjectService())
    app.dependency_overrides.pop(contents_endpoint.get_upload_user)
    try:
        response = client.put(SAVE_URL, params=PARAMS, headers=HEADERS, json=upload_payload())
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required"}
    assert content_service.read_calls == []
    assert content_service.save_calls == []


def test_base64_upload_maps_metadata_lookup_upstream_errors(client, app):
    content_service = UploadContentService(
        read_error=UpstreamServiceError("metadata unavailable", status_code=503)
    )
    configure_upload_dependencies(app, content_service, EditableProjectService())
    try:
        response = client.put(SAVE_URL, params=PARAMS, headers=HEADERS, json=upload_payload())
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json() == {"detail": "metadata unavailable"}
    assert content_service.save_calls == []


def test_base64_upload_maps_save_upstream_errors(client, app):
    content_service = UploadContentService(
        save_error=UpstreamServiceError("save unavailable", status_code=502)
    )
    configure_upload_dependencies(app, content_service, EditableProjectService())
    try:
        response = client.put(
            SAVE_URL,
            params={**PARAMS, "overwrite": "true"},
            headers=HEADERS,
            json=upload_payload(),
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 502
    assert response.json() == {"detail": "save unavailable"}
