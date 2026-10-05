"""Endpoints for proxying JupyterHub contents requests."""

import base64
import binascii
import os
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, cast
from urllib.parse import quote, unquote, urljoin, urlsplit
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Security
from fastapi.security import HTTPBearer
from pydantic import BaseModel
from starlette.background import BackgroundTask
from starlette.responses import StreamingResponse

from ihub_server.api.deps import (
    PrincipalDep,
    ProjectServiceDep,
    ProjectUploadDependencies,
    UploadLockManagerDep,
    get_content_service,
    get_jupyterhub_service,
    get_principal,
    get_project_upload_dependencies,
)
from ihub_server.core.environment import settings
from ihub_server.db import get_user
from ihub_server.services.errors import (
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ServiceError,
    UnauthorizedError,
    UpstreamServiceError,
)

if TYPE_CHECKING:
    from ihub_server.services.contents import ContentService
    from ihub_server.services.jupyterhub import JupyterHubService

SUPPORTED_UPLOAD_EXTENSIONS = (".icmp", ".ipynb", ".ichat", ".ivis", ".txt", ".json")
PROJECT_FILE_UPLOAD_MAX_BYTES = settings.PROJECT_FILE_UPLOAD_MAX_BYTES


class RenameContentRequest(BaseModel):
    """Destination path for a project-file rename."""

    path: str


jupyter_bearer_auth = HTTPBearer(
    scheme_name="JupyterBearerAuth",
    description="Jupyter token forwarded to JupyterHub contents APIs.",
    auto_error=False,
)

router = APIRouter(dependencies=[Security(jupyter_bearer_auth)])

content_service_dep = Depends(get_content_service)
jupyterhub_service_dep = Depends(get_jupyterhub_service)
project_upload_dependencies_dep = Depends(get_project_upload_dependencies)
content_body = Body(...)


async def get_upload_user(
    request: Request,
    content: dict = content_body,
) -> dict[str, Any] | None:
    """Resolve session identity only for base64 project-file uploads."""
    if content.get("format") != "base64":
        return None
    return await get_user(request)


upload_user_dep = Depends(get_upload_user)


@router.get(
    "/upload-policy",
    tags=["Contents"],
    description="Get project file upload constraints.",
)
def get_upload_policy() -> dict[str, object]:
    """Return the browser-visible project file upload policy."""
    return {
        "supported_extensions": list(SUPPORTED_UPLOAD_EXTENSIONS),
        "max_file_size_bytes": PROJECT_FILE_UPLOAD_MAX_BYTES,
    }


@router.get(
    "/download/{path:path}",
    tags=["Contents"],
    description="Download a raw file from a JupyterHub user server.",
    response_description="Raw file download.",
)
async def download_content(
    req: Request,
    path: str,
    jupyter_user: str,
    principal: PrincipalDep,
    jupyter_server_url: str | None = None,
    content_service: "ContentService" = content_service_dep,
    jupyterhub_service: "JupyterHubService" = jupyterhub_service_dep,
):
    """Stream exact file bytes for the authenticated Jupyter user."""
    normalized_jupyter_user = _jupyter_user(jupyter_user)
    if normalized_jupyter_user.casefold() != principal.email.casefold():
        raise HTTPException(
            status_code=403,
            detail="Jupyter user must match authenticated user.",
        )

    jupyter_token = await _jupyter_token(req, principal.email, jupyterhub_service)
    try:
        file_stream = await content_service.stream_file(
            _jupyterhub_base_url(req, jupyter_server_url),
            path,
            principal.email,
            jupyter_token,
        )
    except ServiceError as exc:
        raise _http_exception(exc) from exc

    headers = {
        "Content-Disposition": _content_disposition(path),
        "Content-Type": file_stream.content_type or "application/octet-stream",
    }
    if file_stream.content_length:
        headers["Content-Length"] = file_stream.content_length

    return StreamingResponse(
        file_stream.iter_raw(),
        headers=headers,
        background=BackgroundTask(file_stream.aclose),
    )


@router.get(
    "/read/{path:path}",
    tags=["Contents"],
    description="Get content from a JupyterHub user server.",
    response_description="Retrieved content.",
)
async def read_content(
    req: Request,
    path: str,
    jupyter_user: str,
    content_service: "ContentService" = content_service_dep,
    jupyterhub_service: "JupyterHubService" = jupyterhub_service_dep,
):
    """Retrieve content from the supplied JupyterHub user's contents API."""
    normalized_jupyter_user = _jupyter_user(jupyter_user)
    jupyter_token = await _jupyter_token(
        req,
        normalized_jupyter_user,
        jupyterhub_service,
    )
    try:
        return await content_service.read_content(
            _jupyterhub_base_url(req),
            path,
            normalized_jupyter_user,
            jupyter_token,
            query=_upstream_query(req),
        )
    except ServiceError as exc:
        raise _http_exception(exc) from exc


@router.post(
    "/save/{path:path}",
    tags=["Contents"],
    description="Save content to a JupyterHub user server.",
    response_description="Save successful.",
)
@router.put(
    "/save/{path:path}",
    tags=["Contents"],
    description="Save content to a JupyterHub user server.",
    response_description="Save successful.",
)
async def save_content(
    req: Request,
    path: str,
    jupyter_user: str,
    user: dict[str, Any] | None = upload_user_dep,
    overwrite: bool = False,
    jupyter_server_url: str | None = None,
    content: dict = content_body,
    content_service: "ContentService" = content_service_dep,
    jupyterhub_service: "JupyterHubService" = jupyterhub_service_dep,
    upload_dependencies: ProjectUploadDependencies = project_upload_dependencies_dep,
):
    """Save a Jupyter-compatible contents payload to the user server."""
    normalized_jupyter_user = _jupyter_user(jupyter_user)
    is_base64_upload = content.get("format") == "base64"
    if is_base64_upload:
        principal = get_principal(user)
        if normalized_jupyter_user.casefold() != principal.email.casefold():
            raise HTTPException(
                status_code=403,
                detail="Jupyter user must match authenticated user.",
            )

        try:
            project_id = _project_id_from_save_path(path)
            user_id = upload_dependencies.project_service.resolve_user_by_email(principal.email)
            upload_dependencies.project_service.require_edit_access(project_id, user_id)
            _validate_base64_upload(path, content)
        except ServiceError as exc:
            raise _http_exception(exc) from exc

    save_jupyter_user = principal.email if is_base64_upload else normalized_jupyter_user
    jupyter_token = await _jupyter_token(
        req,
        save_jupyter_user,
        jupyterhub_service,
    )
    try:
        base_url = _jupyterhub_base_url(req, jupyter_server_url)
        if is_base64_upload:
            async with upload_dependencies.lock_manager.lock(
                base_url,
                save_jupyter_user,
                path,
            ):
                if not overwrite:
                    try:
                        await content_service.read_content(
                            base_url,
                            path,
                            save_jupyter_user,
                            jupyter_token,
                            query={"content": "0"},
                        )
                    except NotFoundError:
                        pass
                    else:
                        msg = "A file with this name already exists."
                        raise ConflictError(msg)

                return await content_service.save_content(
                    base_url,
                    path,
                    content,
                    save_jupyter_user,
                    jupyter_token,
                )

        return await content_service.save_content(
            base_url,
            path,
            content,
            save_jupyter_user,
            jupyter_token,
        )
    except ServiceError as exc:
        raise _http_exception(exc) from exc


@router.patch(
    "/rename/{path:path}",
    tags=["Contents"],
    description="Rename project content on a JupyterHub user server.",
    response_description="Rename successful.",
)
async def rename_content(
    req: Request,
    path: str,
    jupyter_user: str,
    rename_request: RenameContentRequest,
    principal: PrincipalDep,
    project_service: ProjectServiceDep,
    upload_lock_manager: UploadLockManagerDep,
    jupyter_server_url: str | None = None,
    content_service: "ContentService" = content_service_dep,
    jupyterhub_service: "JupyterHubService" = jupyterhub_service_dep,
):
    """Rename a writable project file for an authenticated project editor."""
    normalized_jupyter_user = _jupyter_user(jupyter_user)
    if normalized_jupyter_user.casefold() != principal.email.casefold():
        raise HTTPException(
            status_code=403,
            detail="Jupyter user must match authenticated user.",
        )

    try:
        project_id = _validate_project_file_rename(path, rename_request.path)
        user_id = project_service.resolve_user_by_email(principal.email)
        project_service.require_edit_access(project_id, user_id)
        jupyter_token = await _jupyter_token(req, principal.email, jupyterhub_service)
        base_url = _jupyterhub_base_url(req, jupyter_server_url)
        async with upload_lock_manager.lock_many(
            base_url,
            principal.email,
            (path, rename_request.path),
        ):
            return await content_service.rename_content(
                base_url,
                path,
                rename_request.path,
                principal.email,
                jupyter_token,
            )
    except ServiceError as exc:
        raise _http_exception(exc) from exc


@router.delete(
    "/delete/{path:path}",
    tags=["Contents"],
    description="Delete content from a JupyterHub user server.",
    response_description="Delete successful.",
)
async def delete_content(
    req: Request,
    path: str,
    jupyter_user: str,
    jupyter_server_url: str | None = None,
    content_service: "ContentService" = content_service_dep,
    jupyterhub_service: "JupyterHubService" = jupyterhub_service_dep,
):
    """Delete content from the supplied JupyterHub user's contents API."""
    normalized_jupyter_user = _jupyter_user(jupyter_user)
    jupyter_token = await _jupyter_token(
        req,
        normalized_jupyter_user,
        jupyterhub_service,
    )
    try:
        return await content_service.delete_content(
            _jupyterhub_base_url(req, jupyter_server_url),
            path,
            normalized_jupyter_user,
            jupyter_token,
        )
    except ServiceError as exc:
        raise _http_exception(exc) from exc


@router.get(
    "/files/{project:path}",
    tags=["Contents"],
    description="Get project files from a JupyterHub user server.",
    response_description="List of file names.",
)
async def get_files(
    req: Request,
    project: str,
    jupyter_user: str,
    content_service: "ContentService" = content_service_dep,
    jupyterhub_service: "JupyterHubService" = jupyterhub_service_dep,
):
    """Retrieve a directory model from the user's Jupyter contents API."""
    normalized_jupyter_user = _jupyter_user(jupyter_user)
    jupyter_token = await _jupyter_token(
        req,
        normalized_jupyter_user,
        jupyterhub_service,
    )
    try:
        return await content_service.get_files(
            _jupyterhub_base_url(req),
            project,
            normalized_jupyter_user,
            jupyter_token,
        )
    except ServiceError as exc:
        raise _http_exception(exc) from exc


def _upstream_query(req: Request) -> dict[str, str]:
    return {
        key: value
        for key, value in req.query_params.items()
        if key
        not in {
            "jupyter_user",
            "jupyter_token",
            "jupyter_label",
            "jupyter_server_url",
        }
    }


async def _jupyter_token(
    req: Request,
    jupyter_user: str,
    jupyterhub_service: "JupyterHubService",
) -> str:
    authorization = req.headers.get("Authorization")
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token.strip():
            return token.strip()
        raise HTTPException(status_code=422, detail="Jupyter token is required.")

    token_payload = await jupyterhub_service.create_user_token_if_exists(jupyter_user)
    if isinstance(token_payload, Mapping):
        token_payload_mapping = cast("Mapping[object, object]", token_payload)
        token_value = token_payload_mapping.get("token")
        if isinstance(token_value, str) and token_value.strip():
            return token_value.strip()

    raise HTTPException(status_code=422, detail="Jupyter token is required.")


def _jupyter_user(jupyter_user: str) -> str:
    normalized_jupyter_user = unquote(jupyter_user).strip()
    if normalized_jupyter_user:
        return normalized_jupyter_user

    raise HTTPException(status_code=422, detail="Jupyter user is required.")


def _project_id_from_save_path(path: str) -> UUID:
    """Parse a project UUID from a safe project-scoped contents path."""
    segments = path.split("/")
    if path.startswith("/") or any(segment in {".", ".."} for segment in segments):
        msg = "Invalid contents path: absolute paths and dot segments are not allowed."
        raise BadRequestError(msg)

    if len(segments) < 3 or segments[0] != "projects" or any(not segment for segment in segments):
        msg = "Save path must be projects/{project_uuid}/{file_path}."
        raise BadRequestError(msg)

    try:
        project_id = UUID(segments[1])
    except ValueError as exc:
        msg = "Save path contains an invalid project UUID."
        raise BadRequestError(msg) from exc

    if segments[1] != str(project_id):
        msg = "Save path contains an invalid project UUID."
        raise BadRequestError(msg)

    return project_id


def _validate_project_file_rename(old_path: str, new_path: str) -> UUID:
    """Validate a same-directory rename and return its project identifier."""
    old_project_id, old_segments = _project_file_path(old_path, "Source")
    new_project_id, new_segments = _project_file_path(new_path, "Destination")

    if old_project_id != new_project_id:
        msg = "Source and destination paths must belong to the same project."
        raise BadRequestError(msg)

    if old_segments[:-1] != new_segments[:-1]:
        msg = "Renaming a project file cannot move it to another directory."
        raise BadRequestError(msg)

    old_filename = old_segments[-1]
    new_filename = new_segments[-1]
    if not new_filename.strip():
        msg = "Destination path must end with a valid filename."
        raise BadRequestError(msg)

    if _filename_extension(old_filename) != _filename_extension(new_filename):
        msg = "Renaming a project file must preserve its file extension."
        raise BadRequestError(msg)

    if old_path == new_path:
        msg = "Destination path must differ from the source path."
        raise BadRequestError(msg)

    return old_project_id


def _project_file_path(path: str, label: str) -> tuple[UUID, list[str]]:
    """Parse a canonical project-scoped path that ends in a file name."""
    segments = path.split("/")
    if (
        path.startswith("/")
        or len(segments) < 3
        or segments[0] != "projects"
        or any(
            not segment or segment in {".", ".."} or "\\" in segment or "\x00" in segment
            for segment in segments
        )
    ):
        msg = f"{label} path must be projects/{{project_uuid}}/{{file_path}}."
        raise BadRequestError(msg)

    try:
        project_id = UUID(segments[1])
    except ValueError as exc:
        msg = f"{label} path contains an invalid project UUID."
        raise BadRequestError(msg) from exc

    if segments[1] != str(project_id):
        msg = f"{label} path contains an invalid project UUID."
        raise BadRequestError(msg)

    return project_id, segments


def _filename_extension(filename: str) -> str:
    """Return the exact final extension, treating dotfiles as extensionless."""
    extension_index = filename.rfind(".")
    return filename[extension_index:] if extension_index > 0 else ""


def _validate_base64_upload(path: str, content: Mapping[str, object]) -> bool:
    """Validate upload-only fields while leaving existing text saves unchanged."""
    if content.get("format") != "base64":
        return False

    if content.get("type") != "file":
        msg = "Base64 uploads must use type 'file'."
        raise BadRequestError(msg)

    filename = path.rsplit("/", maxsplit=1)[-1]
    if (
        not filename
        or filename.startswith(".")
        or filename.endswith(".")
        or "\\" in filename
        or "\x00" in filename
    ):
        msg = "Invalid upload filename."
        raise BadRequestError(msg)

    extension_index = filename.rfind(".")
    extension = filename[extension_index:].casefold() if extension_index > 0 else ""
    if extension not in SUPPORTED_UPLOAD_EXTENSIONS:
        supported = ", ".join(SUPPORTED_UPLOAD_EXTENSIONS)
        msg = f"Unsupported file extension. Supported extensions: {supported}."
        raise BadRequestError(msg)

    encoded_content = content.get("content")
    if not isinstance(encoded_content, str):
        msg = "Base64 upload content must be a string."
        raise BadRequestError(msg)

    try:
        decoded_content = base64.b64decode(encoded_content, validate=True)
    except (binascii.Error, ValueError) as exc:
        msg = "Upload content is not valid base64."
        raise BadRequestError(msg) from exc

    if len(decoded_content) > PROJECT_FILE_UPLOAD_MAX_BYTES:
        msg = f"Upload exceeds the {PROJECT_FILE_UPLOAD_MAX_BYTES}-byte file size limit."
        raise BadRequestError(msg)

    return True


def _content_disposition(path: str) -> str:
    """Build attachment metadata with safe ASCII and UTF-8 filenames."""
    filename = path.rstrip("/").rsplit("/", maxsplit=1)[-1]
    ascii_filename = "".join(
        character if 32 <= ord(character) < 127 and character not in {'"', "\\"} else "_"
        for character in filename
    )
    ascii_filename = ascii_filename or "download"
    encoded_filename = quote(filename or "download", safe="")
    return f"attachment; filename=\"{ascii_filename}\"; filename*=UTF-8''{encoded_filename}"


def _jupyterhub_base_url(
    req: Request,
    jupyter_server_url: str | None = None,
) -> str:
    jh_host = os.environ.get("JH_HOST")
    if jh_host and jh_host.strip():
        jh_host = jh_host.strip()
        hinted_base_url = _jupyter_server_base_url(jh_host, jupyter_server_url)
        if hinted_base_url:
            return hinted_base_url
        return jh_host

    if jupyter_server_url and jupyter_server_url.startswith("/ijupyterhub/user/"):
        return urljoin(str(req.base_url), jupyter_server_url.lstrip("/"))

    return f"{str(req.base_url).rstrip('/')}/ijupyterhub/"


def _jupyter_server_base_url(
    jh_host: str,
    jupyter_server_url: str | None,
) -> str | None:
    if not jupyter_server_url:
        return None

    server_path = urlsplit(jupyter_server_url).path.rstrip("/")
    if not server_path:
        return None

    hub_path = urlsplit(jh_host).path.rstrip("/")
    if hub_path and server_path.startswith(f"{hub_path}/user/"):
        user_server_path = server_path.removeprefix(hub_path)
    elif server_path.startswith("/ijupyterhub/user/"):
        user_server_path = server_path.removeprefix("/ijupyterhub")
    elif server_path.startswith("/user/"):
        user_server_path = server_path
    else:
        return None

    return urljoin(f"{jh_host.rstrip('/')}/", user_server_path.lstrip("/"))


def _http_exception(exc: ServiceError) -> HTTPException:
    status_code = 500
    if isinstance(exc, BadRequestError):
        status_code = 400
    elif isinstance(exc, UnauthorizedError):
        status_code = 401
    elif isinstance(exc, ForbiddenError):
        status_code = 403
    elif isinstance(exc, NotFoundError):
        status_code = 404
    elif isinstance(exc, ConflictError):
        status_code = 409
    elif isinstance(exc, UpstreamServiceError):
        status_code = exc.status_code

    return HTTPException(status_code=status_code, detail=str(exc))
