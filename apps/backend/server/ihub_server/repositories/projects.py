"""Repository helpers for Project and ProjectPermission CRUD operations."""

from typing import cast
from uuid import UUID

from sqlalchemy import delete
from sqlmodel import Session, col, or_, select

from ihub_server.models import (
    LLM,
    AccessLevel,
    Agent,
    AuthorizedUser,
    Broker,
    MCPServer,
    Project,
    ProjectCreate,
    ProjectPermission,
    ProjectPermissionCreate,
    ProjectUpdate,
    ProjectVisibility,
    RemoteAgentServer,
)


def list_projects_for_user(session: Session, user_id: UUID) -> list[Project]:
    """Return all projects the user owns or has explicit permission on, plus public ones."""
    permitted_project_ids = select(ProjectPermission.project_id).where(
        ProjectPermission.user_id == user_id
    )
    statement = select(Project).where(
        or_(
            Project.owner_id == user_id,
            Project.id.in_(permitted_project_ids),  # type: ignore[attr-defined]
            Project.visibility == ProjectVisibility.PUBLIC,
        )
    )
    return cast(list[Project], session.exec(statement).all())


def get_project(session: Session, project_id: UUID) -> Project | None:
    return session.get(Project, project_id)


def create_project(session: Session, data: ProjectCreate, owner_id: UUID) -> Project:
    db_project = Project.model_validate(data, update={"owner_id": owner_id})
    session.add(db_project)
    session.commit()
    session.refresh(db_project)
    return db_project


def update_project(session: Session, project: Project, updates: ProjectUpdate) -> Project:
    update_data = updates.model_dump(exclude_unset=True)
    project.sqlmodel_update(update_data)
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


def delete_project(session: Session, project: Project) -> None:
    # Delete all project-scoped resources and permissions before deleting the project.
    pid = project.id
    session.exec(delete(Agent).where(col(Agent.project_id) == pid))
    session.exec(delete(LLM).where(col(LLM.project_id) == pid))
    session.exec(delete(MCPServer).where(col(MCPServer.project_id) == pid))
    session.exec(delete(Broker).where(col(Broker.project_id) == pid))
    session.exec(delete(RemoteAgentServer).where(col(RemoteAgentServer.project_id) == pid))
    session.exec(delete(ProjectPermission).where(col(ProjectPermission.project_id) == pid))
    session.delete(project)
    session.commit()


# --- Permission helpers ---


def list_permissions(session: Session, project_id: UUID) -> list[ProjectPermission]:
    statement = select(ProjectPermission).where(ProjectPermission.project_id == project_id)
    return cast(list[ProjectPermission], session.exec(statement).all())


def get_permission(session: Session, project_id: UUID, user_id: UUID) -> ProjectPermission | None:
    statement = select(ProjectPermission).where(
        ProjectPermission.project_id == project_id,
        ProjectPermission.user_id == user_id,
    )
    return session.exec(statement).first()


def create_permission(
    session: Session, project_id: UUID, data: ProjectPermissionCreate
) -> ProjectPermission:
    db_perm = ProjectPermission.model_validate(data, update={"project_id": project_id})
    session.add(db_perm)
    session.commit()
    session.refresh(db_perm)
    return db_perm


def update_permission_access_level(
    session: Session, permission: ProjectPermission, access_level: AccessLevel
) -> ProjectPermission:
    permission.access_level = access_level
    session.add(permission)
    session.commit()
    session.refresh(permission)
    return permission


def delete_permission(session: Session, permission: ProjectPermission) -> None:
    session.delete(permission)
    session.commit()


def get_user_by_email(session: Session, email: str) -> AuthorizedUser | None:
    statement = select(AuthorizedUser).where(AuthorizedUser.email == email)
    return session.exec(statement).first()


def get_user_by_id(session: Session, user_id: UUID) -> AuthorizedUser | None:
    return session.get(AuthorizedUser, user_id)


def list_active_user_emails(session: Session) -> list[str]:
    statement = (
        select(AuthorizedUser.email).where(AuthorizedUser.is_active).order_by(AuthorizedUser.email)
    )
    return cast(list[str], session.exec(statement).all())
