import asyncio
import base64
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from uuid import UUID

import pytest

import ihub_server.api.v1.endpoints.contents as contents_endpoint
from ihub_server.api.deps import Principal, get_content_service, get_principal, get_project_service
from ihub_server.services.errors import (
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    UpstreamServiceError,
)

PROJECT_ID = UUID("11111111-1111-4111-8111-111111111111")
OTHER_PROJECT_ID = UUID("33333333-3333-4333-8333-333333333333")
USER_ID = UUID("22222222-2222-4222-8222-222222222222")
OLD_PATH = f"projects/{PROJECT_ID}/nested/original file.json"
NEW_PATH = f"projects/{PROJECT_ID}/nested/renamed file.json"
RENAME_URL = f"/api/v1/contents/rename/{OLD_PATH}"
ICMP_OLD_PATH = f"projects/{PROJECT_ID}/nested/original campaign.icmp"
ICMP_NEW_PATH = f"projects/{PROJECT_ID}/nested/renamed campaign.icmp"
ICMP_RENAME_URL = f"/api/v1/contents/rename/{ICMP_OLD_PATH}"
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


class RenameContentService:
    def __init__(self, error=None):
        self.error = error
        self.calls = []

    async def rename_content(
        self,
        base_url,
        path,
        new_path,
        jupyter_user,
        jupyter_token,
    ):
        self.calls.append((base_url, path, new_path, jupyter_user, jupyter_token))
        if self.error:
            raise self.error
        return {
            "name": "renamed file.json",
            "path": new_path,
            "type": "file",
            "writable": True,
        }


class ConcurrentProjectService(EditableProjectService):
    def __init__(self, expected_authorizations):
        super().__init__()
        self.expected_authorizations = expected_authorizations
        self.authorizations_completed = Event()
        self._authorization_count = 0
        self._authorization_lock = Lock()

    def require_edit_access(self, project_id, user_id):
        super().require_edit_access(project_id, user_id)
        with self._authorization_lock:
            self._authorization_count += 1
            if self._authorization_count >= self.expected_authorizations:
                self.authorizations_completed.set()


class ConcurrentRenameUploadContentService:
    def __init__(
        self,
        *,
        block_rename=False,
        blocked_upload_path=None,
        rename_error=None,
    ):
        self.block_rename = block_rename
        self.blocked_upload_path = blocked_upload_path
        self.rename_error = rename_error
        self.rename_started = Event()
        self.release_rename = Event()
        self.source_save_started = Event()
        self.destination_save_started = Event()
        self.release_upload = Event()
        self.calls = []
        self._calls_lock = Lock()

    async def rename_content(
        self,
        base_url,
        path,
        new_path,
        jupyter_user,
        jupyter_token,
    ):
        with self._calls_lock:
            self.calls.append(("rename_started", path, new_path))
        self.rename_started.set()
        if self.block_rename:
            while not self.release_rename.is_set():
                await asyncio.sleep(0.001)
        if self.rename_error:
            raise self.rename_error
        with self._calls_lock:
            self.calls.append(("rename_completed", path, new_path))
        return {
            "name": new_path.rsplit("/", 1)[-1],
            "path": new_path,
            "type": "file",
            "writable": True,
        }

    async def save_content(
        self,
        base_url,
        path,
        content,
        jupyter_user,
        jupyter_token,
    ):
        with self._calls_lock:
            self.calls.append(("save_started", path))
        if path == ICMP_OLD_PATH:
            self.source_save_started.set()
        if path == ICMP_NEW_PATH:
            self.destination_save_started.set()
        if path == self.blocked_upload_path:
            while not self.release_upload.is_set():
                await asyncio.sleep(0.001)
        with self._calls_lock:
            self.calls.append(("save_completed", path))
        return {"path": path}


@pytest.fixture(autouse=True)
def configure_rename_dependencies(app):
    project_service = EditableProjectService()
    content_service = RenameContentService()
    app.dependency_overrides[get_principal] = lambda: Principal(
        subject_id=str(USER_ID),
        email="user@example.com",
    )
    app.dependency_overrides[get_project_service] = lambda: project_service
    app.dependency_overrides[get_content_service] = lambda: content_service
    yield project_service, content_service
    app.dependency_overrides.clear()


def upload_payload(raw):
    return {
        "type": "file",
        "format": "base64",
        "content": base64.b64encode(raw).decode("ascii"),
    }


def configure_concurrent_dependencies(app, content_service, project_service):
    app.dependency_overrides[contents_endpoint.get_upload_user] = lambda: {
        "subject_id": str(USER_ID),
        "email": "user@example.com",
        "role": "user",
    }
    app.dependency_overrides[get_content_service] = lambda: content_service
    app.dependency_overrides[get_project_service] = lambda: project_service


def test_rename_authorizes_and_forwards_named_server_request(
    client,
    monkeypatch,
    configure_rename_dependencies,
):
    monkeypatch.setenv("JH_HOST", "http://jupyterhub:8000/ijupyterhub")
    project_service, content_service = configure_rename_dependencies

    response = client.patch(
        RENAME_URL,
        params={
            "jupyter_user": "USER@EXAMPLE.COM",
            "jupyter_server_url": "/ijupyterhub/user/user@example.com/lab-server",
        },
        headers=HEADERS,
        json={"path": NEW_PATH},
    )

    assert response.status_code == 200
    assert response.json()["path"] == NEW_PATH
    assert project_service.calls == [
        ("resolve", "user@example.com"),
        ("authorize", PROJECT_ID, USER_ID),
    ]
    assert content_service.calls == [
        (
            "http://jupyterhub:8000/ijupyterhub/user/user@example.com/lab-server",
            OLD_PATH,
            NEW_PATH,
            "user@example.com",
            "exact-jupyter-token",
        )
    ]


def test_rename_blocks_source_and_destination_overwrite_uploads(client, app):
    content_service = ConcurrentRenameUploadContentService(block_rename=True)
    project_service = ConcurrentProjectService(expected_authorizations=3)
    configure_concurrent_dependencies(app, content_service, project_service)

    executor = ThreadPoolExecutor(max_workers=3)
    try:
        rename_response = executor.submit(
            client.patch,
            ICMP_RENAME_URL,
            params=PARAMS,
            headers=HEADERS,
            json={"path": ICMP_NEW_PATH},
        )
        assert content_service.rename_started.wait(timeout=2)

        source_upload_response = executor.submit(
            client.put,
            f"/api/v1/contents/save/{ICMP_OLD_PATH}",
            params={**PARAMS, "overwrite": "true"},
            headers=HEADERS,
            json=upload_payload(b"source overwrite"),
        )
        destination_upload_response = executor.submit(
            client.put,
            f"/api/v1/contents/save/{ICMP_NEW_PATH}",
            params={**PARAMS, "overwrite": "true"},
            headers=HEADERS,
            json=upload_payload(b"destination overwrite"),
        )
        assert project_service.authorizations_completed.wait(timeout=2)
        assert content_service.source_save_started.wait(timeout=0.1) is False
        assert content_service.destination_save_started.wait(timeout=0.1) is False

        content_service.release_rename.set()
        responses = [
            rename_response.result(timeout=2),
            source_upload_response.result(timeout=2),
            destination_upload_response.result(timeout=2),
        ]
    finally:
        content_service.release_rename.set()
        content_service.release_upload.set()
        executor.shutdown(wait=True, cancel_futures=True)

    assert [response.status_code for response in responses] == [200, 200, 200]
    rename_completed_index = content_service.calls.index(
        ("rename_completed", ICMP_OLD_PATH, ICMP_NEW_PATH)
    )
    assert rename_completed_index < content_service.calls.index(("save_started", ICMP_OLD_PATH))
    assert rename_completed_index < content_service.calls.index(("save_started", ICMP_NEW_PATH))
    assert app.state.upload_lock_manager.active_lock_count == 0


def test_source_upload_lock_blocks_rename_service_entry(client, app):
    content_service = ConcurrentRenameUploadContentService(blocked_upload_path=ICMP_OLD_PATH)
    project_service = ConcurrentProjectService(expected_authorizations=2)
    configure_concurrent_dependencies(app, content_service, project_service)

    executor = ThreadPoolExecutor(max_workers=2)
    try:
        upload_response = executor.submit(
            client.put,
            f"/api/v1/contents/save/{ICMP_OLD_PATH}",
            params={**PARAMS, "overwrite": "true"},
            headers=HEADERS,
            json=upload_payload(b"source upload"),
        )
        assert content_service.source_save_started.wait(timeout=2)

        rename_response = executor.submit(
            client.patch,
            ICMP_RENAME_URL,
            params=PARAMS,
            headers=HEADERS,
            json={"path": ICMP_NEW_PATH},
        )
        assert project_service.authorizations_completed.wait(timeout=2)
        assert content_service.rename_started.wait(timeout=0.1) is False

        content_service.release_upload.set()
        responses = [
            upload_response.result(timeout=2),
            rename_response.result(timeout=2),
        ]
    finally:
        content_service.release_upload.set()
        content_service.release_rename.set()
        executor.shutdown(wait=True, cancel_futures=True)

    assert [response.status_code for response in responses] == [200, 200]
    assert content_service.calls.index(
        ("save_completed", ICMP_OLD_PATH)
    ) < content_service.calls.index(("rename_started", ICMP_OLD_PATH, ICMP_NEW_PATH))
    assert app.state.upload_lock_manager.active_lock_count == 0


def test_failed_rename_releases_source_and_destination_locks(client, app):
    content_service = ConcurrentRenameUploadContentService(
        rename_error=UpstreamServiceError("Jupyter unavailable", status_code=503)
    )
    project_service = ConcurrentProjectService(expected_authorizations=1)
    configure_concurrent_dependencies(app, content_service, project_service)

    response = client.patch(
        ICMP_RENAME_URL,
        params=PARAMS,
        headers=HEADERS,
        json={"path": ICMP_NEW_PATH},
    )

    assert response.status_code == 503
    assert response.json() == {"detail": "Jupyter unavailable"}
    assert app.state.upload_lock_manager.active_lock_count == 0

    source_upload = client.put(
        f"/api/v1/contents/save/{ICMP_OLD_PATH}",
        params={**PARAMS, "overwrite": "true"},
        headers=HEADERS,
        json=upload_payload(b"source after failure"),
    )
    destination_upload = client.put(
        f"/api/v1/contents/save/{ICMP_NEW_PATH}",
        params={**PARAMS, "overwrite": "true"},
        headers=HEADERS,
        json=upload_payload(b"destination after failure"),
    )

    assert [source_upload.status_code, destination_upload.status_code] == [200, 200]
    assert app.state.upload_lock_manager.active_lock_count == 0


def test_rename_rejects_extension_case_change(
    client,
    configure_rename_dependencies,
):
    project_service, content_service = configure_rename_dependencies
    old_path = f"projects/{PROJECT_ID}/nested/original.JSON"
    new_path = f"projects/{PROJECT_ID}/nested/renamed.json"

    response = client.patch(
        f"/api/v1/contents/rename/{old_path}",
        params=PARAMS,
        headers=HEADERS,
        json={"path": new_path},
    )

    assert response.status_code == 400
    assert "preserve its file extension" in response.json()["detail"]
    assert project_service.calls == []
    assert content_service.calls == []


def test_rename_requires_authenticated_principal(client, app):
    app.dependency_overrides.pop(get_principal)

    response = client.patch(
        RENAME_URL,
        params=PARAMS,
        headers=HEADERS,
        json={"path": NEW_PATH},
    )

    assert response.status_code == 401


def test_rename_rejects_jupyter_identity_mismatch(
    client,
    configure_rename_dependencies,
):
    project_service, content_service = configure_rename_dependencies

    response = client.patch(
        RENAME_URL,
        params={"jupyter_user": "other@example.com"},
        headers=HEADERS,
        json={"path": NEW_PATH},
    )

    assert response.status_code == 403
    assert response.json() == {"detail": "Jupyter user must match authenticated user."}
    assert project_service.calls == []
    assert content_service.calls == []


def test_rename_requires_project_edit_access(
    client,
    app,
    configure_rename_dependencies,
):
    _project_service, content_service = configure_rename_dependencies
    project_service = EditableProjectService(ForbiddenError("Edit access required"))
    app.dependency_overrides[get_project_service] = lambda: project_service

    response = client.patch(
        RENAME_URL,
        params=PARAMS,
        headers=HEADERS,
        json={"path": NEW_PATH},
    )

    assert response.status_code == 403
    assert response.json() == {"detail": "Edit access required"}
    assert content_service.calls == []


@pytest.mark.parametrize(
    ("old_path", "new_path"),
    [
        ("projects/not-a-uuid/original.json", "projects/not-a-uuid/renamed.json"),
        (
            f"projects/{PROJECT_ID}/nested/bad\\name.json",
            f"projects/{PROJECT_ID}/nested/renamed file.json",
        ),
        (OLD_PATH, f"projects/{OTHER_PROJECT_ID}/nested/renamed file.json"),
        (OLD_PATH, f"projects/{PROJECT_ID}/other/renamed file.json"),
        (OLD_PATH, f"projects/{PROJECT_ID}/nested/.."),
        (OLD_PATH, f"projects/{PROJECT_ID}/nested/bad\\name.json"),
        (OLD_PATH, f"projects/{PROJECT_ID}/nested/bad\x00name.json"),
        (OLD_PATH, f"projects/{PROJECT_ID}/nested/renamed file.txt"),
        (OLD_PATH, OLD_PATH),
    ],
)
def test_rename_rejects_invalid_source_or_destination_paths(
    client,
    configure_rename_dependencies,
    old_path,
    new_path,
):
    project_service, content_service = configure_rename_dependencies

    response = client.patch(
        f"/api/v1/contents/rename/{old_path}",
        params=PARAMS,
        headers=HEADERS,
        json={"path": new_path},
    )

    assert response.status_code == 400
    assert project_service.calls == []
    assert content_service.calls == []


@pytest.mark.parametrize(
    ("error", "status_code", "detail"),
    [
        (BadRequestError("The campaign file does not contain valid JSON."), 400, "valid JSON"),
        (ConflictError("A file with this name already exists."), 409, "already exists"),
        (NotFoundError("Source file was not found."), 404, "not found"),
        (ForbiddenError("Source file is not writable."), 403, "not writable"),
        (UpstreamServiceError("Jupyter unavailable", status_code=503), 503, "unavailable"),
    ],
)
def test_rename_translates_service_errors(
    client,
    app,
    configure_rename_dependencies,
    error,
    status_code,
    detail,
):
    project_service, _content_service = configure_rename_dependencies
    content_service = RenameContentService(error)
    app.dependency_overrides[get_content_service] = lambda: content_service

    response = client.patch(
        RENAME_URL,
        params=PARAMS,
        headers=HEADERS,
        json={"path": NEW_PATH},
    )

    assert response.status_code == status_code
    assert detail in response.json()["detail"]
    assert project_service.calls[-1] == ("authorize", PROJECT_ID, USER_ID)
