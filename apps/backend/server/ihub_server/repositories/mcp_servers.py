"""Repository helpers for MCPServer CRUD operations."""

from typing import cast
from uuid import UUID

from sqlmodel import Session, or_, select

from ihub_server.models import MCPServer, MCPServerCreate, MCPServerUpdate


def list_mcp_servers(
    session: Session, offset: int, limit: int, project_id: UUID | None = None
) -> list[MCPServer]:
    statement = select(MCPServer)
    if project_id is not None:
        statement = statement.where(
            or_(MCPServer.project_id == project_id, MCPServer.project_id.is_(None))  # type: ignore[union-attr]
        )
    return cast(list[MCPServer], session.exec(statement.offset(offset).limit(limit)).all())


def get_mcp_server(session: Session, mcp_id: int) -> MCPServer | None:
    return session.get(MCPServer, mcp_id)


def create_mcp_server(session: Session, mcp_server: MCPServerCreate) -> MCPServer:
    db_mcp = MCPServer.model_validate(mcp_server)
    session.add(db_mcp)
    session.commit()
    session.refresh(db_mcp)
    return db_mcp


def update_mcp_server(session: Session, mcp: MCPServer, updates: MCPServerUpdate) -> MCPServer:
    mcp_data = updates.model_dump(exclude_unset=True)
    mcp.sqlmodel_update(mcp_data)
    session.add(mcp)
    session.commit()
    session.refresh(mcp)
    return mcp


def delete_mcp_server(session: Session, mcp: MCPServer) -> None:
    session.delete(mcp)
    session.commit()
