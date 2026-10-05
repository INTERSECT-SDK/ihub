"""Schemas for discovered remote agents hosted on remote agent servers."""

from __future__ import annotations

from datetime import UTC, datetime

from pydantic import field_validator
from sqlalchemy import ForeignKey, Integer
from sqlmodel import JSON, Column, Field, SQLModel

from ihub_server.models.remote_agent_server import REMOTE_AGENT_PROTOCOLS


class RemoteAgentBase(SQLModel):
    """Base remote agent model."""

    remote_agent_id: int = Field(
        sa_column=Column(
            "remote_agent_server_id",
            Integer,
            ForeignKey("remoteagentserver.id"),
            nullable=False,
            index=True,
        ),
    )
    assistant_id: str = Field(index=True)
    protocol: str = Field(default="langgraph", regex="^(langgraph|a2a|agui)$")
    graph_id: str | None = None
    name: str
    description: str | None = None
    assistant_metadata: dict | None = Field(default_factory=dict, sa_column=Column(JSON))
    version: int = 1
    status: str = "available"
    remote_updated_at: datetime | None = None
    last_synced_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

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


class RemoteAgent(RemoteAgentBase, table=True):
    """Discovered remote agent model."""

    __tablename__ = "remoteagent"

    id: int | None = Field(default=None, primary_key=True)


class RemoteAgentPublic(RemoteAgentBase):
    """Public remote agent model."""

    id: int
