"""Schemas for remote agent server configuration."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID  # noqa: TC003

from pydantic import field_validator
from sqlmodel import Field, SQLModel

REMOTE_AGENT_PROTOCOLS = ("langgraph", "a2a", "agui")


class RemoteAgentServerBase(SQLModel):
    """Base remote agent server model."""

    name: str = Field(index=True)
    url: str
    protocol: str = Field(default="langgraph", regex="^(langgraph|a2a|agui)$")
    status: str = "unavailable"
    assistant_id: str | None = None
    project_id: UUID | None = Field(default=None, foreign_key="project.id", nullable=True)

    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_validator("protocol")
    @classmethod
    def validate_protocol(cls, protocol: str) -> str:
        """Reject unsupported remote-agent protocols."""
        if protocol not in REMOTE_AGENT_PROTOCOLS:
            msg = f"Unsupported remote-agent protocol: {protocol}"
            raise ValueError(msg)
        return protocol


class RemoteAgentServer(RemoteAgentServerBase, table=True):
    """Private remote agent server model."""

    __tablename__ = "remoteagentserver"

    id: int | None = Field(default=None, primary_key=True)
    auth_token: str | None = None


class RemoteAgentServerPublic(RemoteAgentServerBase):
    """Public remote agent server model."""

    id: int


class RemoteAgentServerCreate(RemoteAgentServerBase):
    """Create remote agent server model."""

    auth_token: str | None = None


class RemoteAgentServerUpdate(SQLModel):
    """Update remote agent server model."""

    name: str | None = None
    url: str | None = None
    protocol: str | None = Field(default=None, regex="^(langgraph|a2a|agui)$")
    assistant_id: str | None = None
    auth_token: str | None = None
    status: str | None = None
    project_id: UUID | None = None

    @field_validator("protocol")
    @classmethod
    def validate_protocol(cls, protocol: str | None) -> str | None:
        """Reject unsupported protocol updates."""
        if protocol is not None and protocol not in REMOTE_AGENT_PROTOCOLS:
            msg = f"Unsupported remote-agent protocol: {protocol}"
            raise ValueError(msg)
        return protocol
