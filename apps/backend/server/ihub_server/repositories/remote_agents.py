"""Repository helpers for discovered RemoteAgent records."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import cast

from sqlmodel import Session, col, delete, select

from ihub_server.models import RemoteAgent


def list_remote_agents(session: Session, offset: int, limit: int) -> list[RemoteAgent]:
    return cast(
        list[RemoteAgent],
        session.exec(select(RemoteAgent).offset(offset).limit(limit)).all(),
    )


def list_remote_agents_for_remote_agent_server(
    session: Session,
    remote_agent_server_id: int,
) -> list[RemoteAgent]:
    statement = select(RemoteAgent).where(
        col(RemoteAgent.remote_agent_id) == remote_agent_server_id,
    )
    return cast(list[RemoteAgent], session.exec(statement).all())


def get_remote_agent_by_key(
    session: Session,
    remote_agent_server_id: int,
    remote_agent_id: str,
) -> RemoteAgent | None:
    statement = select(RemoteAgent).where(
        col(RemoteAgent.remote_agent_id) == remote_agent_server_id,
        col(RemoteAgent.assistant_id) == remote_agent_id,
    )
    return cast(RemoteAgent | None, session.exec(statement).first())


def upsert_remote_agent(
    session: Session,
    remote_agent_server_id: int,
    remote_agent_id: str,
    protocol: str,
    graph_id: str | None,
    name: str,
    description: str | None,
    assistant_metadata: dict | None,
    version: int,
    remote_updated_at: datetime | None,
) -> RemoteAgent:
    now = datetime.now(UTC)
    record = get_remote_agent_by_key(session, remote_agent_server_id, remote_agent_id)
    if record is None:
        record = RemoteAgent(
            remote_agent_id=remote_agent_server_id,
            assistant_id=remote_agent_id,
            protocol=protocol,
            graph_id=graph_id,
            name=name,
            description=description,
            assistant_metadata=assistant_metadata or {},
            version=version,
            status="available",
            remote_updated_at=remote_updated_at,
            last_synced_at=now,
        )
    else:
        record.protocol = protocol
        record.graph_id = graph_id
        record.name = name
        record.description = description
        record.assistant_metadata = assistant_metadata or {}
        record.version = version
        record.status = "available"
        record.remote_updated_at = remote_updated_at
        record.last_synced_at = now
        record.updated_at = now

    session.add(record)
    return record


def delete_missing_remote_agents(
    session: Session,
    remote_agent_server_id: int,
    remote_agent_ids_to_keep: set[str],
) -> None:
    statement = delete(RemoteAgent).where(
        col(RemoteAgent.remote_agent_id) == remote_agent_server_id,
    )
    if remote_agent_ids_to_keep:
        statement = statement.where(
            col(RemoteAgent.assistant_id).notin_(remote_agent_ids_to_keep),
        )
    session.exec(statement)


def delete_all_remote_agents_for_server(
    session: Session,
    remote_agent_server_id: int,
) -> None:
    """Delete all remote agents for a given remote agent server."""
    statement = delete(RemoteAgent).where(
        col(RemoteAgent.remote_agent_id) == remote_agent_server_id,
    )
    session.exec(statement)
