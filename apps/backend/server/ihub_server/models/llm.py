"""Schemas for a Large Language Model"""

from __future__ import annotations

from uuid import UUID  # noqa: TC003

from sqlmodel import Field, SQLModel


class LLMBase(SQLModel):
    """Base LLM model"""

    label: str | None = Field(default=None, index=True)
    url: str
    provider: str
    model: str
    api_version: str | None = Field(default=None)
    deployment_name: str | None = Field(default=None)
    project_id: UUID | None = Field(default=None, foreign_key="project.id", nullable=True)


class LLM(LLMBase, table=True):
    """Private LLM model"""

    id: int | None = Field(default=None, primary_key=True)
    api_key: str | None = Field(default=None)


class LLMPublic(LLMBase):
    """Public LLM model"""

    id: int


class LLMCreate(LLMBase):
    """Create LLM model"""

    api_key: str | None = None


class LLMUpdate(SQLModel):
    """Update LLM model"""

    label: str | None = None
    url: str | None = None
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    api_version: str | None = None
    deployment_name: str | None = None
    project_id: UUID | None = None
