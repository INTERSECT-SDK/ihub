from types import SimpleNamespace

import pytest

from ihub_server.services.campaign_hydration import CampaignHydrator


def test_model_hierarchy_lookup_supports_service_id_and_capability_name():
    service_service = SimpleNamespace(
        get_service=lambda _service_id: SimpleNamespace(hierarchy="by.id"),
        get_service_by_name=lambda _name: SimpleNamespace(hierarchy="by.name"),
    )
    hydrator = CampaignHydrator(service_service)
    payload = {
        "task_groups": [
            {
                "tasks": [
                    {"id": "task-id", "capability_metadata": {"service_id": 7}},
                    {"id": "task-name", "capability": "Named Service"},
                ]
            }
        ]
    }

    assert hydrator.build_model_task_hierarchies(payload) == {
        "task-id": "by.id",
        "task-name": "by.name",
    }


@pytest.mark.parametrize("wrapped", [False, True])
def test_model_event_task_hydrates_output_without_input(wrapped):
    hydrator = CampaignHydrator()
    payload_schema = {
        "type": "object",
        "properties": {"temperature": {"type": "number"}},
    }
    event_definition = (
        {"payload": payload_schema, "schemaFormat": "application/schema+json"}
        if wrapped
        else payload_schema
    )
    task = {
        "id": "event-task",
        "hierarchy": "capability",
        "capability": "Sensor",
        "operation_id": None,
        "event_name": "temperature",
        "event_mode": "once",
        "event_count": None,
        "input": None,
        "output": None,
        "capability_metadata": {
            "endpoints_schema": {
                "events": {"temperature": event_definition},
            }
        },
    }

    hydrated = hydrator._hydrate_model_task(task, set())

    assert hydrated["input"] is None
    assert hydrated["output"]["schema"] == payload_schema
    assert hydrated["output"]["values"][0]["var"] == "temperature"


@pytest.mark.parametrize("wrapped", [False, True])
def test_model_event_task_hydrates_referenced_output(wrapped):
    hydrator = CampaignHydrator()
    reference = {"$ref": "#/components/schemas/EventPayload"}
    event_definition = {"payload": reference} if wrapped else reference
    payload_schema = {
        "type": "object",
        "properties": {"temperature": {"type": "number"}},
    }
    task = {
        "id": "event-task",
        "hierarchy": "capability",
        "capability": "Sensor",
        "operation_id": None,
        "event_name": "temperature",
        "event_mode": "once",
        "event_count": None,
        "input": None,
        "output": None,
        "capability_metadata": {
            "endpoints_schema": {
                "events": {"temperature": event_definition},
                "components": {"schemas": {"EventPayload": payload_schema}},
            }
        },
    }

    hydrated = hydrator._hydrate_model_task(task, set())

    assert hydrated["input"] is None
    assert hydrated["output"]["schema"] == payload_schema
    assert hydrated["output"]["values"][0]["var"] == "temperature"


@pytest.mark.parametrize(
    ("event_definition", "expected_var"),
    [
        ({"type": "integer"}, "value"),
        ({"type": "string", "title": "message"}, "message"),
        (
            {
                "anyOf": [
                    {"type": "null"},
                    {"type": "number", "title": "reading"},
                ]
            },
            "reading",
        ),
        ({"type": "array", "title": "samples", "items": {"type": "number"}}, "samples"),
    ],
)
def test_model_event_task_root_output_names_match_schema_extraction(
    event_definition,
    expected_var,
):
    hydrator = CampaignHydrator()
    task = {
        "id": "event-task",
        "hierarchy": "capability",
        "capability": "Sensor",
        "operation_id": None,
        "event_name": "reading",
        "event_mode": "once",
        "event_count": None,
        "input": None,
        "output": None,
        "capability_metadata": {"endpoints_schema": {"events": {"reading": event_definition}}},
    }

    hydrated = hydrator._hydrate_model_task(task, set())

    assert hydrated["input"] is None
    assert hydrated["output"]["values"][0]["var"] == expected_var


def test_model_event_task_without_metadata_remains_gate_only():
    hydrator = CampaignHydrator()
    task = {
        "id": "event-task",
        "operation_id": None,
        "event_name": "temperature",
        "input": None,
        "output": None,
    }

    hydrated = hydrator._hydrate_model_task(task, set())

    assert hydrated["input"] is None
    assert hydrated["output"] is None


@pytest.mark.parametrize(
    ("satisfied_by", "manual_input_values", "mapped_fields", "property_schema"),
    [
        ("manual input", {"required_value": 7}, set(), {"type": "integer"}),
        ("mapping", {}, {"required_value"}, {"type": "integer"}),
        ("schema default", {}, set(), {"type": "integer", "default": 3}),
    ],
)
def test_referenced_required_input_accepts_existing_value_sources(
    satisfied_by,
    manual_input_values,
    mapped_fields,
    property_schema,
):
    hydrator = CampaignHydrator()
    input_schema = {
        "type": "object",
        "required": ["required_value"],
        "properties": {"required_value": property_schema},
    }
    task = {
        "id": f"task-satisfied-by-{satisfied_by}",
        "operation_id": "consume",
        "input": None,
        "output": {},
        "manual_input_values": manual_input_values,
        "endpoint_channel": {
            "subscribe": {
                "message": {"payload": {"$ref": "#/components/schemas/Outer/properties/inner"}}
            }
        },
        "capability_metadata": {
            "endpoints_schema": {
                "components": {
                    "schemas": {
                        "Outer": {
                            "type": "object",
                            "properties": {"inner": input_schema},
                        }
                    }
                }
            }
        },
    }

    hydrated = hydrator._hydrate_model_task(task, mapped_fields)

    assert hydrated["input"]["schema"]["properties"]["required_value"] == (
        {**property_schema, "default": 7} if satisfied_by == "manual input" else property_schema
    )
