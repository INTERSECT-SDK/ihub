"""Schemas for the MCP Server"""

from __future__ import annotations

from uuid import UUID  # noqa: TC003

from sqlmodel import Field, SQLModel


class MCPServerBase(SQLModel):
    """Base MCP Server model"""

    label: str = Field(index=True)
    url: str
    status: str = "unavailable"
    project_id: UUID | None = Field(default=None, foreign_key="project.id", nullable=True)


class MCPServer(MCPServerBase, table=True):
    """Private MCP Server model"""

    id: int | None = Field(default=None, primary_key=True)
    token: str


class MCPServerPublic(MCPServerBase):
    """Public MCP Server model"""

    id: int


class MCPServerCreate(MCPServerBase):
    """Create MCP Server model"""

    token: str


class MCPServerUpdate(SQLModel):
    """Update MCP Server model"""

    label: str | None = None
    url: str | None = None
    token: str | None = None
    status: str | None = None
    project_id: UUID | None = None
