"""Schemas for the message broker"""

from __future__ import annotations

from sqlmodel import Field, SQLModel


class JupyterBase(SQLModel):
    """Base jupyter model"""

    label: str = Field(index=True)
    hostIP: str  # noqa: N815
    port: str
    status: str = "unavailable"


class JupyterServer(JupyterBase, table=True):
    """Private jupyter model"""

    id: int | None = Field(default=None, primary_key=True)
    token: str


class JupyterPublic(JupyterBase):
    """Public jupyter model"""

    id: int


class JupyterCreate(JupyterBase):
    """Create jupyter model"""

    token: str


class JupyterUpdate(SQLModel):
    """Update jupyter model"""

    label: str | None = None
    hostIP: str | None = None  # noqa: N815
    port: str | None = None
    token: str | None = None
    status: str | None = None
