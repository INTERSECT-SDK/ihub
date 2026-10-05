"""Service layer for Project management with permission enforcement."""

import logging
import os
import time
from datetime import UTC, datetime
from urllib.parse import quote
from uuid import UUID

import httpx
from sqlmodel import Session

from ihub_server.models import (
    AccessLevel,
    Project,
    ProjectCreate,
    ProjectPermission,
    ProjectPermissionCreate,
    ProjectPermissionPublic,
    ProjectPublic,
    ProjectUpdate,
    ProjectVisibility,
)
from ihub_server.repositories import projects as project_repository
from ihub_server.services.errors import ConflictError, ForbiddenError, NotFoundError

_log = logging.getLogger("ihub-server")


class ProjectService:
    def __init__(self, session: Session) -> None:
        self._session = session

    # --- Project CRUD ---

    def list_projects(self, user_id: UUID) -> list[Project]:
        return project_repository.list_projects_for_user(self._session, user_id)

    def list_projects_public(self, user_id: UUID) -> list[ProjectPublic]:
        projects = self.list_projects(user_id)
        return [self.to_public_project(project, user_id) for project in projects]

    def get_project(self, project_id: UUID, user_id: UUID) -> Project:
        project = project_repository.get_project(self._session, project_id)
        if not project:
            msg = "Project not found."
            raise NotFoundError(msg)
        self._require_access(project, user_id)
        return project

    def to_public_project(self, project: Project, user_id: UUID) -> ProjectPublic:
        owner = project_repository.get_user_by_id(self._session, project.owner_id)
        permissions = project_repository.list_permissions(self._session, project.id)
        current_user_access_level = AccessLevel.VIEW
        if project.owner_id == user_id:
            current_user_access_level = AccessLevel.EDIT
        else:
            current_user_permission = next(
                (permission for permission in permissions if permission.user_id == user_id),
                None,
            )
            if current_user_permission:
                current_user_access_level = current_user_permission.access_level
        effective_visibility = (
            ProjectVisibility.PUBLIC
            if project.visibility == ProjectVisibility.PUBLIC
            else (ProjectVisibility.SHARED if permissions else ProjectVisibility.PRIVATE)
        )
        return ProjectPublic.model_validate(
            project,
            update={
                "owner_email": owner.email if owner else None,
                "visibility": effective_visibility,
                "current_user_access_level": current_user_access_level,
            },
        )

    def create_project(
        self,
        data: ProjectCreate,
        owner_id: UUID,
        owner_jupyter_user: str | None = None,
    ) -> Project:
        project = project_repository.create_project(self._session, data, owner_id)
        if owner_jupyter_user:
            self._ensure_project_directory(owner_jupyter_user, str(project.id))
        return project

    def _ensure_project_directory(self, user_name: str, project_id: str) -> None:
        """Best-effort creation of projects/{project_id} via Jupyter APIs."""
        jh_host = os.environ.get("JH_HOST")
        jh_admin_token = os.environ.get("JH_ADMIN_TOKEN")
        if not jh_host or not jh_admin_token:
            _log.info("Skipping project directory bootstrap: missing JH_HOST or JH_ADMIN_TOKEN.")
            return

        headers = {"Authorization": f"token {jh_admin_token}"}
        # Preserve characters JupyterHub commonly uses in usernames (notably '@').
        encoded_user = quote(user_name, safe="@._-")

        try:
            with httpx.Client(timeout=30.0) as client:
                # Ensure user exists in JupyterHub.
                user_resp = client.get(
                    f"{jh_host}/hub/api/users/{encoded_user}",
                    headers=headers,
                )
                if user_resp.status_code == 404:
                    create_user_resp = client.post(
                        f"{jh_host}/hub/api/users/{encoded_user}",
                        headers=headers,
                    )
                    create_user_resp.raise_for_status()
                else:
                    user_resp.raise_for_status()

                # Ensure single-user server is up.
                start_resp = client.post(
                    f"{jh_host}/hub/api/users/{encoded_user}/server",
                    headers=headers,
                )
                if start_resp.status_code not in (201, 202, 400):
                    start_resp.raise_for_status()

                # Wait until the default server is ready before hitting /api/contents.
                deadline = time.monotonic() + 60
                while True:
                    status_resp = client.get(
                        f"{jh_host}/hub/api/users/{encoded_user}",
                        headers=headers,
                    )
                    status_resp.raise_for_status()
                    default_server = status_resp.json().get("servers", {}).get("")
                    if default_server and default_server.get("ready"):
                        break
                    if time.monotonic() > deadline:
                        _log.warning(
                            "Timed out waiting for Jupyter server readiness for user %s.",
                            user_name,
                        )
                        return
                    time.sleep(0.5)

                token_resp = client.post(
                    f"{jh_host}/hub/api/users/{encoded_user}/tokens",
                    headers={
                        **headers,
                        "Content-Type": "application/json",
                    },
                    json={
                        "note": (
                            "Token created by iHub ProjectService "
                            f"for project directory bootstrap ({project_id})"
                        ),
                        "scopes": [f"access:servers!user={user_name}"],
                    },
                )
                token_resp.raise_for_status()
                user_token = token_resp.json().get("token")
                if not isinstance(user_token, str) or not user_token:
                    _log.warning(
                        "Skipping project directory bootstrap: token missing for user %s.",
                        user_name,
                    )
                    return

                base = jh_host.rstrip("/")
                server_base = f"{base}/user/{encoded_user}"
                content_headers = {
                    "Authorization": f"token {user_token}",
                    "Content-Type": "application/json",
                }

                for dir_path in ("projects", f"projects/{project_id}"):
                    dir_resp = client.put(
                        f"{server_base}/api/contents/{dir_path}",
                        headers=content_headers,
                        json={"type": "directory"},
                    )
                    if dir_resp.status_code not in (200, 201, 409):
                        dir_resp.raise_for_status()

        except httpx.HTTPError as exc:
            _log.warning(
                "Project %s created but failed to bootstrap Jupyter directory for user %s: %s",
                project_id,
                user_name,
                exc,
            )

    def update_project(self, project_id: UUID, updates: ProjectUpdate, user_id: UUID) -> Project:
        project = project_repository.get_project(self._session, project_id)
        if not project:
            msg = "Project not found."
            raise NotFoundError(msg)
        self._require_owner(project, user_id)
        update_data = updates.model_dump(exclude_unset=True)
        update_data["updated_at"] = datetime.now(UTC)
        return project_repository.update_project(
            self._session, project, ProjectUpdate.model_validate(update_data)
        )

    def delete_project(self, project_id: UUID, user_id: UUID) -> None:
        project = project_repository.get_project(self._session, project_id)
        if not project:
            msg = "Project not found."
            raise NotFoundError(msg)
        self._require_owner(project, user_id)
        project_repository.delete_project(self._session, project)

    # --- Permission management ---

    def list_permissions(self, project_id: UUID, user_id: UUID) -> list[ProjectPermissionPublic]:
        project = project_repository.get_project(self._session, project_id)
        if not project:
            msg = "Project not found."
            raise NotFoundError(msg)
        self._require_owner(project, user_id)
        permissions = project_repository.list_permissions(self._session, project_id)
        return [self.to_public_permission(permission) for permission in permissions]

    def to_public_permission(self, permission: ProjectPermission) -> ProjectPermissionPublic:
        user = project_repository.get_user_by_id(self._session, permission.user_id)
        return ProjectPermissionPublic.model_validate(
            permission,
            update={"user_email": user.email if user else None},
        )

    def grant_access(
        self,
        project_id: UUID,
        data: ProjectPermissionCreate,
        owner_id: UUID,
    ) -> ProjectPermissionPublic:
        project = project_repository.get_project(self._session, project_id)
        if not project:
            msg = "Project not found."
            raise NotFoundError(msg)
        self._require_owner(project, owner_id)
        if data.user_id == owner_id:
            msg = "Cannot grant access to the project owner."
            raise ConflictError(msg)
        existing = project_repository.get_permission(self._session, project_id, data.user_id)
        if existing:
            msg = "User already has access to this project."
            raise ConflictError(msg)
        created = project_repository.create_permission(self._session, project_id, data)
        if project.visibility == ProjectVisibility.PRIVATE:
            project.visibility = ProjectVisibility.SHARED
            project.updated_at = datetime.now(UTC)
            self._session.add(project)
            self._session.commit()
            self._session.refresh(project)
        return self.to_public_permission(created)

    def update_access_level(
        self,
        project_id: UUID,
        target_user_id: UUID,
        access_level: AccessLevel,
        owner_id: UUID,
    ) -> ProjectPermissionPublic:
        project = project_repository.get_project(self._session, project_id)
        if not project:
            msg = "Project not found."
            raise NotFoundError(msg)
        self._require_owner(project, owner_id)
        permission = project_repository.get_permission(self._session, project_id, target_user_id)
        if not permission:
            msg = "Permission not found."
            raise NotFoundError(msg)
        updated = project_repository.update_permission_access_level(
            self._session, permission, access_level
        )
        return self.to_public_permission(updated)

    def revoke_access(self, project_id: UUID, target_user_id: UUID, owner_id: UUID) -> None:
        project = project_repository.get_project(self._session, project_id)
        if not project:
            msg = "Project not found."
            raise NotFoundError(msg)
        self._require_owner(project, owner_id)
        if target_user_id == owner_id:
            msg = "Cannot revoke owner's own access."
            raise ConflictError(msg)
        permission = project_repository.get_permission(self._session, project_id, target_user_id)
        if not permission:
            msg = "Permission not found."
            raise NotFoundError(msg)
        project_repository.delete_permission(self._session, permission)
        remaining_permissions = project_repository.list_permissions(self._session, project_id)
        if project.visibility == ProjectVisibility.SHARED and not remaining_permissions:
            project.visibility = ProjectVisibility.PRIVATE
            project.updated_at = datetime.now(UTC)
            self._session.add(project)
            self._session.commit()
            self._session.refresh(project)

    def resolve_user_by_email(self, email: str) -> UUID:
        """Look up an AuthorizedUser by email and return their id."""
        user = project_repository.get_user_by_email(self._session, email)
        if not user:
            msg = f"No user found with email '{email}'."
            raise NotFoundError(msg)
        return user.id

    def list_active_user_emails(self) -> list[str]:
        return project_repository.list_active_user_emails(self._session)

    def get_user_access_level(self, project_id: UUID, user_id: UUID) -> AccessLevel | None:
        """Return the explicit access level for a user, or None if owner/no access."""
        project = project_repository.get_project(self._session, project_id)
        if not project:
            return None
        if project.owner_id == user_id:
            return None  # Owner — handled separately
        perm = project_repository.get_permission(self._session, project_id, user_id)
        return perm.access_level if perm else None

    def require_edit_access(self, project_id: UUID, user_id: UUID) -> None:
        """Require ownership or an explicit edit permission for a project."""
        project = project_repository.get_project(self._session, project_id)
        if not project:
            msg = "Project not found."
            raise NotFoundError(msg)
        if project.owner_id == user_id:
            return

        permission = project_repository.get_permission(self._session, project_id, user_id)
        if permission and permission.access_level == AccessLevel.EDIT:
            return

        msg = "Edit access to this project is required."
        raise ForbiddenError(msg)

    # --- Internal permission guards ---

    def _require_owner(self, project: Project, user_id: UUID) -> None:
        if project.owner_id != user_id:
            msg = "Only the project owner can perform this action."
            raise ForbiddenError(msg)

    def _require_access(self, project: Project, user_id: UUID) -> None:
        if project.owner_id == user_id:
            return
        if project.visibility == ProjectVisibility.PUBLIC:
            return
        perm = project_repository.get_permission(self._session, project.id, user_id)
        if not perm:
            msg = "You do not have access to this project."
            raise ForbiddenError(msg)
