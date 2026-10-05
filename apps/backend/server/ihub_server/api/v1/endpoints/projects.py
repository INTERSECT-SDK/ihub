"""CRUD endpoints for Project management and sharing."""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated
from uuid import UUID  # noqa: TC003

from fastapi import APIRouter, Depends, HTTPException, Query

from ihub_server.api.deps import (
    PrincipalDep,
    get_project_service,
    get_remote_agent_service,
)
from ihub_server.models import (
    AccessLevel,
    ProjectCreate,
    ProjectPermissionGrantRequest,
    ProjectPermissionPublic,
    ProjectPublic,
    ProjectUpdate,
    RemoteAgentServerPublic,
)
from ihub_server.services.errors import ConflictError, ForbiddenError, NotFoundError

if TYPE_CHECKING:
    from ihub_server.services.projects import ProjectService
    from ihub_server.services.remote_agent_servers import RemoteAgentServerService

router = APIRouter()

project_service_dep = Depends(get_project_service)
remote_agent_service_dep = Depends(get_remote_agent_service)


# --- Project endpoints ---


@router.get(
    "/",
    tags=["Projects"],
    description="List all projects accessible to the current user.",
    response_model=list[ProjectPublic],
)
def list_projects(
    principal: PrincipalDep,
    project_service: ProjectService = project_service_dep,
):
    user_id = _resolve_principal_id(project_service, principal.email)
    return project_service.list_projects_public(user_id)


@router.get(
    "/active-users",
    tags=["Projects"],
    description="List active authorized user emails for sharing.",
    response_model=list[str],
)
def list_active_users(
    principal: PrincipalDep,
    project_service: ProjectService = project_service_dep,
):
    _resolve_principal_id(project_service, principal.email)
    return project_service.list_active_user_emails()


@router.post(
    "/",
    tags=["Projects"],
    description="Create a new project.",
    response_model=ProjectPublic,
    status_code=201,
)
def create_project(
    data: ProjectCreate,
    principal: PrincipalDep,
    project_service: ProjectService = project_service_dep,
):
    owner_id = _resolve_principal_id(project_service, principal.email)
    project = project_service.create_project(data, owner_id, principal.email)
    return project_service.to_public_project(project, owner_id)


@router.get(
    "/{project_id}",
    tags=["Projects"],
    description="Get a project by ID.",
    response_model=ProjectPublic,
)
def get_project(
    project_id: UUID,
    principal: PrincipalDep,
    project_service: ProjectService = project_service_dep,
):
    user_id = _resolve_principal_id(project_service, principal.email)
    try:
        project = project_service.get_project(project_id, user_id)
        return project_service.to_public_project(project, user_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.patch(
    "/{project_id}",
    tags=["Projects"],
    description="Update a project (owner only).",
    response_model=ProjectPublic,
)
def update_project(
    project_id: UUID,
    updates: ProjectUpdate,
    principal: PrincipalDep,
    project_service: ProjectService = project_service_dep,
):
    user_id = _resolve_principal_id(project_service, principal.email)
    try:
        project = project_service.update_project(project_id, updates, user_id)
        return project_service.to_public_project(project, user_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.delete(
    "/{project_id}",
    tags=["Projects"],
    description="Delete a project (owner only).",
    status_code=204,
)
def delete_project(
    project_id: UUID,
    principal: PrincipalDep,
    project_service: ProjectService = project_service_dep,
):
    user_id = _resolve_principal_id(project_service, principal.email)
    try:
        project_service.delete_project(project_id, user_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


# --- Permission endpoints ---


@router.get(
    "/{project_id}/permissions",
    tags=["Projects"],
    description="List all user permissions for a project (owner only).",
    response_model=list[ProjectPermissionPublic],
)
def list_permissions(
    project_id: UUID,
    principal: PrincipalDep,
    project_service: ProjectService = project_service_dep,
):
    user_id = _resolve_principal_id(project_service, principal.email)
    try:
        return project_service.list_permissions(project_id, user_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post(
    "/{project_id}/permissions",
    tags=["Projects"],
    description="Grant a user access to a project by email (owner only).",
    response_model=ProjectPermissionPublic,
    status_code=201,
)
def grant_access(
    project_id: UUID,
    data: ProjectPermissionGrantRequest,
    principal: PrincipalDep,
    project_service: ProjectService = project_service_dep,
):
    owner_id = _resolve_principal_id(project_service, principal.email)
    try:
        target_user_id = project_service.resolve_user_by_email(data.user_email)
        from ihub_server.models import ProjectPermissionCreate

        perm_data = ProjectPermissionCreate(user_id=target_user_id, access_level=data.access_level)
        return project_service.grant_access(project_id, perm_data, owner_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.patch(
    "/{project_id}/permissions/{user_id}",
    tags=["Projects"],
    description="Change a user's access level on a project (owner only).",
    response_model=ProjectPermissionPublic,
)
def update_access_level(
    project_id: UUID,
    user_id: UUID,
    access_level: AccessLevel,
    principal: PrincipalDep,
    project_service: ProjectService = project_service_dep,
):
    owner_id = _resolve_principal_id(project_service, principal.email)
    try:
        return project_service.update_access_level(project_id, user_id, access_level, owner_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.delete(
    "/{project_id}/permissions/{user_id}",
    tags=["Projects"],
    description="Revoke a user's access to a project (owner only).",
    status_code=204,
)
def revoke_access(
    project_id: UUID,
    user_id: UUID,
    principal: PrincipalDep,
    project_service: ProjectService = project_service_dep,
):
    owner_id = _resolve_principal_id(project_service, principal.email)
    try:
        project_service.revoke_access(project_id, user_id, owner_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get(
    "/{project_id}/remote-agent-servers",
    tags=["Projects"],
    description="Get list of remote agent servers configured for a project.",
    response_description="List of remote agent servers",
    response_model=list[RemoteAgentServerPublic],
)
def read_remote_agent_servers_for_project(
    project_id: UUID,
    _principal: PrincipalDep,
    remote_agent_service: RemoteAgentServerService = remote_agent_service_dep,
    offset: int = 0,
    limit: Annotated[int, Query(le=100)] = 100,
):
    """List remote agent servers scoped to a specific project."""
    return remote_agent_service.list_remote_agent_servers_for_project(project_id, offset, limit)


# --- Helpers ---


def _resolve_principal_id(project_service: ProjectService, email: str) -> UUID:
    try:
        return project_service.resolve_user_by_email(email)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
