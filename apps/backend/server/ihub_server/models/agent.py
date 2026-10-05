"""Schemas for Agent definitions."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from uuid import UUID, uuid4

from sqlmodel import JSON, Column, Field, SQLModel


class AgentVisibility(str, Enum):
    PRIVATE = "private"
    SHARED = "shared"  # shared with specific users
    PUBLIC = "public"  # visible to all users


class AgentBase(SQLModel):
    """Base Agent model."""

    name: str
    description: str | None = None

    owner_id: UUID | None = None
    visibility: AgentVisibility = AgentVisibility.PRIVATE

    parent_agent_id: UUID | None = None
    version: int = 1

    model_id: int | None = Field(default=None, foreign_key="llm.id")
    project_id: UUID | None = Field(default=None, foreign_key="project.id", nullable=True)

    tool_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON))

    system_prompt: str
    graph_type: str
    memory_type: str

    runtime_config: dict | None = Field(default_factory=dict, sa_column=Column(JSON))

    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class Agent(AgentBase, table=True):
    """Agent model for DB storage."""

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)


class AgentPublic(AgentBase):
    """Public Agent model."""

    id: UUID


class AgentCreate(AgentBase):
    """Create Agent model."""


class AgentUpdate(SQLModel):
    """Update Agent model."""

    name: str | None = None
    description: str | None = None
    owner_id: UUID | None = None
    visibility: AgentVisibility | None = None
    parent_agent_id: UUID | None = None
    version: int | None = None
    model_id: int | None = None
    project_id: UUID | None = None
    tool_ids: list[str] | None = None
    system_prompt: str | None = None
    graph_type: str | None = None
    memory_type: str | None = None
    runtime_config: dict | None = None
