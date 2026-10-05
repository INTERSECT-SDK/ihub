"""Service layer for MCP server CRUD operations."""

from uuid import UUID

from sqlmodel import Session

from ihub_server.models import MCPServer, MCPServerCreate, MCPServerUpdate
from ihub_server.repositories import mcp_servers as mcp_repository
from ihub_server.services.errors import NotFoundError


class MCPServerService:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_mcp_servers(
        self, offset: int, limit: int, project_id: UUID | None = None
    ) -> list[MCPServer]:
        return mcp_repository.list_mcp_servers(self._session, offset, limit, project_id)

    def get_mcp_server(self, mcp_id: int) -> MCPServer:
        mcp = mcp_repository.get_mcp_server(self._session, mcp_id)
        if not mcp:
            msg = "MCP server not found"
            raise NotFoundError(msg)
        return mcp

    def create_mcp_server(self, mcp_server: MCPServerCreate) -> MCPServer:
        return mcp_repository.create_mcp_server(self._session, mcp_server)

    def update_mcp_server(self, mcp_id: int, updates: MCPServerUpdate) -> MCPServer:
        mcp = mcp_repository.get_mcp_server(self._session, mcp_id)
        if not mcp:
            msg = "MCP server not found"
            raise NotFoundError(msg)
        return mcp_repository.update_mcp_server(self._session, mcp, updates)

    def delete_mcp_server(self, mcp_id: int) -> None:
        mcp = mcp_repository.get_mcp_server(self._session, mcp_id)
        if not mcp:
            msg = "MCP server not found"
            raise NotFoundError(msg)
        mcp_repository.delete_mcp_server(self._session, mcp)
