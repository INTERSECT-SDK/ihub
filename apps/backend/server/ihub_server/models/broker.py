"""Schemas for the message broker"""

from __future__ import annotations

from enum import Enum
from uuid import UUID  # noqa: TC003

from pydantic import ConfigDict
from sqlalchemy import Boolean, Column, true
from sqlmodel import Field, SQLModel


class ProtocolEnum(str, Enum):
    MQTT = "mqtt5.0"
    AMQP = "amqp0.9.1"


class OrchestratorHealthStatus(str, Enum):
    """Observed reachability of a broker's configured orchestrator."""

    CONNECTED = "connected"
    DISCONNECTED = "disconnected"
    NOT_CONFIGURED = "not_configured"


class OrchestratorHealth(SQLModel):
    """Read-only orchestrator health response."""

    status: OrchestratorHealthStatus


class BrokerBase(SQLModel):
    """Base broker model"""

    model_config = ConfigDict(populate_by_name=True)  # type: ignore[assignment]

    label: str = Field(index=True)
    host_ip: str = Field(alias="hostIP", sa_column=Column("hostIP"))
    port: str
    protocol: ProtocolEnum
    username: str
    orchestrator_url: str | None = Field(
        default=None,
        alias="orchestratorUrl",
        sa_column=Column("orchestratorUrl"),
    )
    status: str = "unavailable"
    auto_connect_enabled: bool = Field(
        default=True,
        alias="autoConnectEnabled",
        sa_column=Column(
            "auto_connect_enabled",
            Boolean,
            nullable=False,
            server_default=true(),
        ),
    )
    project_id: UUID | None = Field(default=None, foreign_key="project.id", nullable=True)


class Broker(BrokerBase, table=True):
    """Private broker model"""

    id: int | None = Field(default=None, primary_key=True)
    password: str
    orchestrator_api_key: str | None = Field(
        default=None,
        alias="orchestratorApiKey",
        sa_column=Column("orchestratorApiKey"),
    )


class BrokerPublic(BrokerBase):
    """Public broker model"""

    id: int


class BrokerCreate(BrokerBase):
    """Create broker model"""

    password: str
    orchestrator_api_key: str | None = Field(
        default=None,
        alias="orchestratorApiKey",
        sa_column=Column("orchestratorApiKey"),
    )


class BrokerUpdate(SQLModel):
    """Update broker model"""

    label: str | None = None
    host_ip: str | None = Field(default=None, alias="hostIP", sa_column=Column("hostIP"))
    port: str | None = None
    protocol: ProtocolEnum | None = None
    username: str | None = None
    password: str | None = None
    orchestrator_url: str | None = Field(
        default=None,
        alias="orchestratorUrl",
        sa_column=Column("orchestratorUrl"),
    )
    orchestrator_api_key: str | None = Field(
        default=None,
        alias="orchestratorApiKey",
        sa_column=Column("orchestratorApiKey"),
    )
    status: str | None = None
    auto_connect_enabled: bool | None = Field(default=None, alias="autoConnectEnabled")
    project_id: UUID | None = None
