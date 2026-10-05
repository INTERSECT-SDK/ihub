"""Repository helpers for RemoteAgentServer CRUD operations."""

from typing import cast
from uuid import UUID

from sqlmodel import Session, select

from ihub_server.models import (
    RemoteAgentServer,
    RemoteAgentServerCreate,
    RemoteAgentServerUpdate,
)


def list_remote_agents(session: Session, offset: int, limit: int) -> list[RemoteAgentServer]:
    return cast(
        list[RemoteAgentServer],
        session.exec(select(RemoteAgentServer).offset(offset).limit(limit)).all(),
    )


def list_remote_agents_for_project(
    session: Session, project_id: UUID, offset: int, limit: int
) -> list[RemoteAgentServer]:
    """List remote agent servers for a specific project."""
    return cast(
        list[RemoteAgentServer],
        session.exec(
            select(RemoteAgentServer)
            .where(RemoteAgentServer.project_id == project_id)
            .offset(offset)
            .limit(limit)
        ).all(),
    )


def get_remote_agent(session: Session, remote_agent_id: int) -> RemoteAgentServer | None:
    return session.get(RemoteAgentServer, remote_agent_id)


def create_remote_agent(
    session: Session,
    remote_agent: RemoteAgentServerCreate,
) -> RemoteAgentServer:
    db_remote_agent = RemoteAgentServer.model_validate(remote_agent)
    session.add(db_remote_agent)
    session.commit()
    session.refresh(db_remote_agent)
    return db_remote_agent


def update_remote_agent(
    session: Session,
    remote_agent: RemoteAgentServer,
    updates: RemoteAgentServerUpdate,
) -> RemoteAgentServer:
    remote_agent_data = updates.model_dump(exclude_unset=True)
    remote_agent.sqlmodel_update(remote_agent_data)
    session.add(remote_agent)
    session.commit()
    session.refresh(remote_agent)
    return remote_agent


def delete_remote_agent(session: Session, remote_agent: RemoteAgentServer) -> None:
    session.delete(remote_agent)
    session.commit()
