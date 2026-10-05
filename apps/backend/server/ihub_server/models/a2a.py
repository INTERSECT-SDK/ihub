"""A2A Agent Card models used for remote-agent discovery."""

from __future__ import annotations

from typing import Any

from a2a.compat.v0_3 import types as legacy_types
from a2a.compat.v0_3.conversions import to_core_agent_card
from a2a.types import AgentCard as ProtocolAgentCard
from a2a.utils.errors import InvalidParamsError
from a2a.utils.proto_utils import validate_proto_required_fields
from google.protobuf.json_format import ParseDict, ParseError
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, ValidationError, model_validator


class A2AModel(BaseModel):
    """Base model that accepts future A2A fields while validating known fields."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class A2AAgentInterface(A2AModel):
    """A protocol interface advertised by an A2A agent."""

    url: HttpUrl
    protocol_binding: str = Field(alias="protocolBinding")
    protocol_version: str = Field(alias="protocolVersion")
    tenant: str | None = None


class A2AAgentCapabilities(A2AModel):
    """Optional interaction features advertised by an A2A agent."""

    streaming: bool = False
    push_notifications: bool = Field(default=False, alias="pushNotifications")
    extended_agent_card: bool = Field(default=False, alias="extendedAgentCard")
    extensions: list[dict[str, Any]] = Field(default_factory=list)


class A2AAgentSkill(A2AModel):
    """A skill advertised in an A2A Agent Card."""

    id: str
    name: str
    description: str
    tags: list[str]
    examples: list[str] = Field(default_factory=list)
    input_modes: list[str] | None = Field(default=None, alias="inputModes")
    output_modes: list[str] | None = Field(default=None, alias="outputModes")


class A2AAgentProvider(A2AModel):
    """Organization responsible for an A2A agent."""

    organization: str
    url: HttpUrl


class A2AAgentCard(A2AModel):
    """Public A2A Agent Card, including legacy 0.3 discovery fields."""

    name: str
    description: str
    version: str
    supported_interfaces: list[A2AAgentInterface] = Field(
        default_factory=list,
        alias="supportedInterfaces",
    )
    capabilities: A2AAgentCapabilities
    default_input_modes: list[str] = Field(alias="defaultInputModes")
    default_output_modes: list[str] = Field(alias="defaultOutputModes")
    skills: list[A2AAgentSkill]
    provider: A2AAgentProvider | None = None
    documentation_url: HttpUrl | None = Field(default=None, alias="documentationUrl")
    security_schemes: dict[str, Any] = Field(default_factory=dict, alias="securitySchemes")

    # A2A 0.3 cards advertised one primary URL instead of supportedInterfaces.
    url: HttpUrl | None = None
    protocol_version: str | None = Field(default=None, alias="protocolVersion")
    preferred_transport: str | None = Field(default=None, alias="preferredTransport")

    @model_validator(mode="after")
    def require_interface(self) -> A2AAgentCard:
        """Require a current supported interface or the legacy primary URL."""
        if not self.supported_interfaces and self.url is None:
            msg = "Agent Card must define supportedInterfaces or url"
            raise ValueError(msg)
        return self


def validate_a2a_agent_card(payload: Any) -> A2AAgentCard:
    """Validate current cards with the SDK and retain A2A 0.3 compatibility."""
    card = A2AAgentCard.model_validate(payload)
    to_protocol_agent_card(payload, validated_card=card)
    return card


def to_protocol_agent_card(
    payload: Any,
    *,
    validated_card: A2AAgentCard | None = None,
) -> ProtocolAgentCard:
    """Convert a current or legacy JSON Agent Card to the SDK's core type."""
    card = validated_card or A2AAgentCard.model_validate(payload)
    try:
        if card.supported_interfaces:
            protocol_card = ParseDict(payload, ProtocolAgentCard())
            validate_proto_required_fields(protocol_card)
            return protocol_card

        legacy_card = legacy_types.AgentCard.model_validate(payload)
        return to_core_agent_card(legacy_card)
    except (InvalidParamsError, ParseError, ValidationError) as exc:
        msg = f"Invalid A2A Agent Card: {exc}"
        raise ValueError(msg) from exc
