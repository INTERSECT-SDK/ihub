"""Tests for lifecycle schema parsing."""

import json
from copy import deepcopy
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from ihub_server.utils.lifecycle_message import (
    extract_lifecycle_identity,
    parse_broker_message,
)


def test_extract_lifecycle_identity_requires_full_context():
    headers = SimpleNamespace(
        source="org.facility.system.service",
        message_id="message-id",
    )
    payload = {
        "schema": {
            "capabilities": {
                "BaseCapability": {},
                "ExampleCapability": {"endpoints": []},
            }
        }
    }

    assert extract_lifecycle_identity(headers, payload, broker_id=7) is None


def test_extract_lifecycle_identity_ignores_endpoint_validation():
    headers = SimpleNamespace(
        source="org.facility.system.subsystem.service",
        message_id="message-id",
    )
    payload = {
        "schema": {
            "capabilities": {
                "BaseCapability": {},
                "ExampleCapability": {"endpoints": []},
            }
        }
    }

    identity = extract_lifecycle_identity(headers, payload, broker_id=7)

    assert identity is not None
    assert identity.broker_id == 7
    assert identity.sdk_capability_name == "ExampleCapability"
    assert str(identity.hierarchy) == "org.facility.system.subsystem.service"


def test_parse_broker_message_preserves_components_without_mutating_payload():
    event_definition = {"payload": {"$ref": "#/components/schemas/TaskProgressEvent"}}
    components = {
        "schemas": {
            "TaskProgressEvent": {
                "type": "object",
                "properties": {"progress": {"type": "number"}},
            }
        }
    }
    payload = {
        "schema": {
            "capabilities": {
                "BaseCapability": {},
                "LongRunningTasks": {
                    "endpoints": {},
                    "events": {"task_progress": event_definition},
                },
            },
            "components": components,
        }
    }
    original_payload = deepcopy(payload)
    headers = SimpleNamespace(
        source="org.facility.system.subsystem.service",
        created_at=datetime(2026, 8, 18, tzinfo=UTC),
        message_id="message-id",
    )

    parsed = parse_broker_message(headers, payload, broker_id=7)

    assert parsed is not None
    assert parsed.endpoints_schema == {
        "endpoints": {},
        "events": {"task_progress": event_definition},
        "components": components,
    }
    assert payload == original_payload
    assert parsed.endpoints_schema is not payload["schema"]["capabilities"]["LongRunningTasks"]
    assert parsed.endpoints_schema["components"] is not payload["schema"]["components"]


@pytest.mark.parametrize(
    "schemas",
    [
        {
            "Node": {
                "type": "object",
                "properties": {"next": {"$ref": "#/components/schemas/Node"}},
            }
        },
        {
            "A": {
                "type": "object",
                "properties": {"b": {"$ref": "#/components/schemas/B"}},
            },
            "B": {
                "type": "object",
                "properties": {"a": {"$ref": "#/components/schemas/A"}},
            },
        },
    ],
    ids=["direct-recursion", "indirect-recursion"],
)
def test_parse_broker_message_preserves_recursive_references(schemas):
    payload = {
        "schema": {
            "capabilities": {
                "BaseCapability": {},
                "RecursiveCapability": {
                    "endpoints": {
                        "recursive": {
                            "publish": {
                                "message": {"payload": {"$ref": "#/components/schemas/Node"}}
                            }
                        }
                    }
                },
            },
            "components": {"schemas": schemas},
        }
    }
    headers = SimpleNamespace(
        source="org.facility.system.subsystem.service",
        created_at=datetime(2026, 9, 21, tzinfo=UTC),
        message_id="recursive-message",
    )

    parsed = parse_broker_message(headers, payload, broker_id=7)

    assert parsed is not None
    assert parsed.endpoints_schema["components"]["schemas"] == schemas
    assert "$ref" in json.dumps(parsed.endpoints_schema)
    json.dumps(parsed.endpoints_schema)


@pytest.mark.parametrize(
    "payload",
    [
        {"schema": []},
        {"schema": {"capabilities": []}},
        {"schema": {"capabilities": {"BaseCapability": {}}}},
        {
            "schema": {
                "capabilities": {
                    "BaseCapability": {},
                    "InvalidCapability": {"endpoints": []},
                }
            }
        },
    ],
)
def test_parse_broker_message_rejects_unsupported_schema_shapes(payload):
    headers = SimpleNamespace(
        source="org.facility.system.subsystem.service",
        created_at=datetime(2026, 9, 21, tzinfo=UTC),
        message_id="invalid-message",
    )

    with pytest.raises((TypeError, ValueError), match="Lifecycle advertisement"):
        parse_broker_message(headers, payload, broker_id=7)
