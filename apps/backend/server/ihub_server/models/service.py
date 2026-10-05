"""Schema for an INTERSECT service"""

from __future__ import annotations

from datetime import UTC, datetime

from pydantic import BaseModel
from sqlmodel import Field, SQLModel


class Hierarchy(BaseModel):
    """INTERSECT 5-part service hierarchy.

    Not a DB table — used for validation, serialization, and constructing
    the dot-separated hierarchy string consumed by the orchestrator.
    """

    organization: str
    facility: str
    system: str
    subsystem: str
    service: str

    def __str__(self) -> str:
        return f"{self.organization}.{self.facility}.{self.system}.{self.subsystem}.{self.service}"


class ServiceBase(SQLModel):
    """Base Service model"""

    name: str = Field(index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    broker_id: int | None = Field(default=None, foreign_key="broker.id")
    system: str
    subsystem: str = Field(default="")
    organization: str = Field(index=True)
    facility: str
    last_lifecycle_message: datetime | None = Field(default=None)

    @property
    def hierarchy(self) -> Hierarchy:
        return Hierarchy(
            organization=self.organization,
            facility=self.facility,
            system=self.system,
            subsystem=self.subsystem,
            service=self.name,
        )


class Service(ServiceBase, table=True):
    """Private Service message model"""

    id: int | None = Field(default=None, primary_key=True)


class ServiceCreate(ServiceBase):
    """Create Service message model"""


class ServicePublic(ServiceBase):
    """Public Service message model"""

    id: int


class ServiceUpdate(SQLModel):
    """Service model when updating"""

    name: str | None = None
    created_at: datetime | None = None
    broker_id: int | None = None
    system: str | None = None
    subsystem: str | None = None
    organization: str | None = None
    facility: str | None = None
    last_lifecycle_message: datetime | None = None
