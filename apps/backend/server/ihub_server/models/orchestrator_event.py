"""Schema for an Orchestrator Event capability"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Index
from sqlmodel import ARRAY, JSON, Column, Field, SQLModel, String


class OrchestratorEventBase(SQLModel):
    """Orchestrator Event Base model"""

    campaign_id: str
    run_id: str | None = None
    step_id: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    event_type: str | None = None
    fields_to_populate: list[str] | None = Field(default=None, sa_column=Column(ARRAY(String)))
    exception_message: str | None = None
    payload: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))


class OrchestratorEvent(OrchestratorEventBase, table=True):
    """Private Orchestrator Event model"""

    __table_args__ = (
        Index(
            "ix_orchestratorevent_run_id_step_id_id",
            "run_id",
            "step_id",
            "id",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)


class OrchestratorEventCreate(OrchestratorEventBase):
    """Create Orchestrator Event model"""


class OrchestratorEventPublic(OrchestratorEventBase):
    """Public Orchestrator Event model"""

    id: int
