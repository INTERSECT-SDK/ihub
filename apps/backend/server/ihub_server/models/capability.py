"""Schema for an INTERSECT capability"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import UniqueConstraint
from sqlmodel import JSON, Column, Field, SQLModel

CAPABILITY_SERVICE_NAME_CONSTRAINT = "uq_capability_service_id_name"


class CapabilityBase(SQLModel):
    """Base Capability model"""

    name: str = Field(index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    broker_id: int | None = Field(default=None, foreign_key="broker.id")
    service_id: int = Field(foreign_key="service.id")
    last_lifecycle_message: datetime | None = Field(default=None)
    lifecycle_error: str | None = Field(default=None)
    lifecycle_error_at: datetime | None = Field(default=None)
    endpoints_schema: dict | None = Field(default={}, sa_column=Column(JSON))


class Capability(CapabilityBase, table=True):
    """Private Capability message model"""

    __table_args__ = (
        UniqueConstraint(
            "service_id",
            "name",
            name=CAPABILITY_SERVICE_NAME_CONSTRAINT,
        ),
    )

    id: int | None = Field(default=None, primary_key=True)


class CapabilityCreate(CapabilityBase):
    """Create Capability message model"""


class CapabilityPublic(CapabilityBase):
    """Public Capability message model"""

    id: int
    lifecycle_last_updated: datetime | None = None


class CapabilityUpdate(SQLModel):
    """Capability model when updating"""

    name: str | None = None
    created_at: datetime | None = None
    broker_id: int | None = None
    service_id: int | None = None
    last_lifecycle_message: datetime | None = None
    lifecycle_error: str | None = None
    lifecycle_error_at: datetime | None = None
    endpoints_schema: dict | None = None
