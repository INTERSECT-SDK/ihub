"""Schema for an INTERSECT capability"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlmodel import JSON, Column, Field, SQLModel


class FlowceptMessageBase(SQLModel):
    """Base Flowcept Message model"""

    activity_id: str = Field(index=True)
    campaign_id: str = Field(index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    message: dict | None = Field(default={}, sa_column=Column(JSON))


class FlowceptMessage(FlowceptMessageBase, table=True):
    """Private Flowcept Message model"""

    id: int | None = Field(default=None, primary_key=True)


class FlowceptMessageCreate(FlowceptMessageBase):
    """Create Flowcept Message model"""


class FlowceptMessagePublic(FlowceptMessageBase):
    """Public Flowcept Message model"""

    id: int | None = Field(default=None, primary_key=True)
