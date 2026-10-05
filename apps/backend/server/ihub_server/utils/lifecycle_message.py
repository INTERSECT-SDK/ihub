"""Utility funciton for broker messages"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from dateutil import parser  # type: ignore[import-untyped]

from ihub_server.models.service import Hierarchy

if TYPE_CHECKING:
    from datetime import datetime

    from intersect_sdk_common.control_plane.messages.lifecycle import LifecycleMessageHeaders


@dataclass
class ParsedBrokerMessage:
    message_id: str
    broker_id: int | None
    endpoints_schema: dict[str, Any] = field(init=False)
    created_at: datetime
    hierarchy: Hierarchy
    sdk_capability_name: str = field(init=False)
    endpoint_names: str = field(init=False)

    # Flat accessors so LifecycleMessage.model_validate(parsed_message) keeps working.
    @property
    def organization(self) -> str:
        return self.hierarchy.organization

    @property
    def facility(self) -> str:
        return self.hierarchy.facility

    @property
    def system(self) -> str:
        return self.hierarchy.system

    @property
    def subsystem(self) -> str:
        return self.hierarchy.subsystem

    @property
    def service(self) -> str:
        return self.hierarchy.service


@dataclass(frozen=True)
class LifecycleMessageIdentity:
    """Minimal context needed to attribute an advertisement ingest failure."""

    message_id: str
    broker_id: int
    hierarchy: Hierarchy
    sdk_capability_name: str


def extract_lifecycle_identity(
    msg_headers: LifecycleMessageHeaders,
    msg_payload: dict[str, Any],
    broker_id: int,
) -> LifecycleMessageIdentity | None:
    """Extract identity without validating endpoint or component metadata."""
    source = getattr(msg_headers, "source", None)
    if not isinstance(source, str):
        return None

    hierarchy_parts = source.split(".")
    if len(hierarchy_parts) != 5 or any(not part for part in hierarchy_parts):
        return None

    if not isinstance(msg_payload, dict):
        return None
    schema = msg_payload.get("schema")
    if not isinstance(schema, dict):
        return None
    capabilities = schema.get("capabilities")
    if not isinstance(capabilities, dict) or len(capabilities) < 2:
        return None

    sdk_capability_name = list(capabilities)[1]
    if not isinstance(sdk_capability_name, str) or not sdk_capability_name:
        return None

    return LifecycleMessageIdentity(
        message_id=str(getattr(msg_headers, "message_id", "")),
        broker_id=broker_id,
        hierarchy=Hierarchy(
            organization=hierarchy_parts[0],
            facility=hierarchy_parts[1],
            system=hierarchy_parts[2],
            subsystem=hierarchy_parts[3],
            service=hierarchy_parts[4],
        ),
        sdk_capability_name=sdk_capability_name,
    )


def parse_broker_message(
    msg_headers: LifecycleMessageHeaders, msg_payload: dict[str, Any], broker_id: int | None = None
) -> ParsedBrokerMessage | None:
    """Parse the broker message"""
    source: str = msg_headers.source
    created_at = parser.parse(msg_headers.created_at.isoformat())

    msg_id: str = str(msg_headers.message_id)
    organization, facility, system, subsystem, service = source.split(".")

    hierarchy = Hierarchy(
        organization=organization,
        facility=facility,
        system=system,
        subsystem=subsystem,
        service=service,
    )
    info = ParsedBrokerMessage(msg_id, broker_id, created_at, hierarchy)

    if not isinstance(msg_payload, dict) or "schema" not in msg_payload:
        # Return None for now. May parse other types of messages in the future.
        return None

    schema = msg_payload["schema"]
    if not isinstance(schema, dict):
        msg = "Lifecycle advertisement schema must be an object"
        raise TypeError(msg)

    # Note: lifecycle message has 'capabilities', but describes single capability.
    # Keep the established second-entry selection because it is part of the current
    # SDK advertisement contract (the first entry is BaseCapability).
    capability_schema = schema.get("capabilities")
    if not isinstance(capability_schema, dict) or len(capability_schema) < 2:
        msg = "Lifecycle advertisement capabilities must contain a capability definition"
        raise ValueError(msg)

    sdk_capability_name = list(capability_schema)[1]
    selected_capability = capability_schema[sdk_capability_name]
    if not isinstance(selected_capability, dict):
        msg = "Lifecycle advertisement capability definition must be an object"
        raise TypeError(msg)

    endpoints = selected_capability.get("endpoints")
    if not isinstance(endpoints, dict):
        msg = "Lifecycle advertisement capability endpoints must be an object"
        raise TypeError(msg)

    endpoints_schema = deepcopy(selected_capability)
    components = schema.get("components")
    if components is not None:
        if not isinstance(components, dict):
            msg = "Lifecycle advertisement components must be an object"
            raise TypeError(msg)
        endpoints_schema["components"] = deepcopy(components)

    info.endpoints_schema = endpoints_schema
    info.sdk_capability_name = sdk_capability_name
    info.endpoint_names = ", ".join(endpoints)

    return info
