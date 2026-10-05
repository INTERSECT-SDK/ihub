"""Schemas for persisted campaign orchestrator runs."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Any, Literal

from sqlalchemy import JSON, Column, Index, String
from sqlmodel import Field, SQLModel

from ihub_server.models.orchestrator_event import (  # noqa: TC001 - Pydantic resolves this at runtime.
    OrchestratorEventPublic,
)


class CampaignRunStatus(str, Enum):
    """Persisted lifecycle states for an orchestrator campaign run."""

    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    ABORTED = "ABORTED"


class CampaignRunOutcome(str, Enum):
    """Persisted terminal outcome for an accepted orchestrator run."""

    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELED = "CANCELED"
    INTERRUPTED = "INTERRUPTED"


class CampaignRunBase(SQLModel):
    """Shared fields for campaign run records."""

    user_email: str | None = Field(default=None, index=True)
    campaign_id: str = Field(index=True)
    run_id: str = Field(index=True, unique=True)
    run_at: datetime = Field(default_factory=lambda: datetime.now(UTC), index=True)
    orchestrator_url: str | None = None
    status: CampaignRunStatus | None = Field(
        default=CampaignRunStatus.ACTIVE,
        sa_column=Column(
            String,
            nullable=True,
            server_default=CampaignRunStatus.ACTIVE.value,
        ),
    )
    ended_at: datetime | None = None
    outcome: CampaignRunOutcome | None = Field(
        default=None,
        sa_column=Column(String, nullable=True),
    )
    campaign_name: str | None = None
    broker_id: int | None = None


class CampaignRun(CampaignRunBase, table=True):
    """Table model for campaign run history."""

    __table_args__ = (
        Index(
            "ix_campaignrun_user_email_status_run_at",
            "user_email",
            "status",
            "run_at",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    submitted_campaign_snapshot: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    orchestrator_campaign_snapshot: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )


class CampaignRunCreate(CampaignRunBase):
    """Create payload for campaign run history."""

    submitted_campaign_snapshot: dict[str, Any] | None = None
    orchestrator_campaign_snapshot: dict[str, Any] | None = None


class CampaignRunPublic(CampaignRunBase):
    """Public campaign run history record."""

    id: int
    snapshot_available: bool = False

    @classmethod
    def from_run(cls, run: CampaignRun) -> CampaignRunPublic:
        """Project a database row without serializing its snapshot documents."""
        if run.id is None:
            msg = "Persisted campaign run is missing its primary key."
            raise ValueError(msg)
        return cls.model_validate(
            run,
            update={
                "id": run.id,
                "snapshot_available": (
                    run.submitted_campaign_snapshot is not None
                    and run.orchestrator_campaign_snapshot is not None
                ),
            },
        )


class CampaignRunSnapshots(SQLModel):
    """Immutable campaign representations captured for one run."""

    schema_version: int = 1
    run_id: str
    captured_at: datetime
    submitted_document_kind: Literal["icmp", "orchestrator_campaign"]
    submitted_campaign: dict[str, Any]
    orchestrator_campaign: dict[str, Any]


class CampaignRunRecovery(SQLModel):
    """User-scoped run snapshot used to restore an active campaign editor."""

    run: CampaignRunPublic
    events: list[OrchestratorEventPublic]
