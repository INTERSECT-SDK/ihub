"""Schema for the broker lifecyle message"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

LIFECYCLE_MESSAGE_CONTEXT_CONSTRAINT = "uq_lifecyclemessage_broker_capability_context"


class LifecycleMessageBase(SQLModel):
    """Base lifecycle message model"""

    message_id: str
    broker_id: int = Field(foreign_key="broker.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    last_updated: datetime = Field(default_factory=lambda: datetime.now(UTC))
    organization: str = Field(index=True)
    facility: str
    system: str
    subsystem: str | None = None
    service: str = Field(index=True)
    sdk_capability_name: str
    endpoint_names: str


class LifecycleMessage(LifecycleMessageBase, table=True):
    """Lifecycle message model"""

    __table_args__ = (
        UniqueConstraint(
            "broker_id",
            "organization",
            "facility",
            "system",
            "subsystem",
            "service",
            "sdk_capability_name",
            name=LIFECYCLE_MESSAGE_CONTEXT_CONSTRAINT,
        ),
    )

    id: int | None = Field(default=None, primary_key=True)


class LifecycleMessageCreate(LifecycleMessageBase):
    """Create lifecycle message model"""


class LifecycleMessagePublic(LifecycleMessageBase):
    """Public lifecycle message model"""
