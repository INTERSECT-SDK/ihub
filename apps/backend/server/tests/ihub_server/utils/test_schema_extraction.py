"""Tests for endpoint JSON Schema extraction."""

import json

import pytest

from ihub_server.utils.schema_extraction import extract_endpoint_schema


def _value_names(values):
    return [value.var for value in values]


def _schema_document(definitions):
    return {"components": {"schemas": definitions}, "$defs": definitions}


def test_extract_endpoint_schema_preserves_ordinary_object_behavior():
    schema, values = extract_endpoint_schema(
        {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "count": {"type": "integer"},
            },
        },
        {},
        {"count": 3},
    )

    assert schema == {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "count": {"type": "integer", "default": 3},
        },
    }
    assert _value_names(values) == ["name", "count"]


def test_extract_endpoint_schema_resolves_direct_and_chained_references():
    definitions = {
        "Alias": {"$ref": "#/components/schemas/Payload"},
        "Payload": {
            "type": "object",
            "properties": {"reading": {"type": "number"}},
        },
    }

    schema, values = extract_endpoint_schema(
        {"$ref": "#/components/schemas/Alias"},
        _schema_document(definitions),
    )

    assert schema == {
        "type": "object",
        "properties": {"reading": {"type": "number"}},
    }
    assert _value_names(values) == ["reading"]


def test_extract_endpoint_schema_resolves_nested_reference_as_json():
    definitions = {
        "Envelope": {
            "type": "object",
            "properties": {
                "payload": {"$ref": "#/components/schemas/Payload"},
            },
        },
        "Payload": {
            "type": "object",
            "properties": {"reading": {"type": "number"}},
        },
    }

    schema, values = extract_endpoint_schema(
        {"$ref": "#/components/schemas/Envelope"},
        _schema_document(definitions),
    )

    assert schema == {
        "type": "object",
        "properties": {
            "payload": {
                "type": "object",
                "properties": {"reading": {"type": "number"}},
            },
        },
    }
    assert _value_names(values) == ["payload"]
    json.dumps(schema)


@pytest.mark.parametrize(
    ("reference", "expected_type"),
    [
        ("#/components/schemas/Outer/properties/inner", "number"),
        ("#/components/schemas/Escaped/properties/path~1with~0tilde", "string"),
        ("#/components/schemas/Tuple/prefixItems/1", "boolean"),
    ],
    ids=["nested-property", "escaped-segment", "array-index"],
)
def test_extract_endpoint_schema_resolves_complete_json_pointer_paths(
    reference,
    expected_type,
):
    schema_document = {
        "components": {
            "schemas": {
                "Outer": {
                    "type": "object",
                    "properties": {"inner": {"type": "number", "title": "selected"}},
                },
                "Escaped": {
                    "type": "object",
                    "properties": {"path/with~tilde": {"type": "string", "title": "selected"}},
                },
                "Tuple": {
                    "type": "array",
                    "prefixItems": [
                        {"type": "integer"},
                        {"type": "boolean", "title": "selected"},
                    ],
                },
            }
        }
    }

    schema, values = extract_endpoint_schema({"$ref": reference}, schema_document)

    assert schema == {
        "type": "object",
        "properties": {"selected": {"type": expected_type, "title": "selected"}},
    }
    assert _value_names(values) == ["selected"]


def test_extract_endpoint_schema_resolves_nested_array_union_and_pointer_references():
    definitions = {
        "Reading/latest~value": {"type": "number"},
        "Sample": {"type": "integer"},
    }
    payload = {
        "type": "object",
        "properties": {
            "reading": {
                "$ref": "#/components/schemas/Reading~1latest~0value",
                "title": "Latest reading",
            },
            "samples": {
                "type": "array",
                "items": {"$ref": "#/$defs/Sample"},
            },
            "choice": {
                "anyOf": [
                    {"type": "null"},
                    {"$ref": "#/components/schemas/Sample"},
                ]
            },
        },
    }

    schema, values = extract_endpoint_schema(payload, _schema_document(definitions))

    assert schema == {
        "type": "object",
        "properties": {
            "reading": {"type": "number", "title": "Latest reading"},
            "samples": {"type": "array", "items": {"type": "integer"}},
            "choice": {"anyOf": [{"type": "null"}, {"type": "integer"}]},
        },
    }
    assert _value_names(values) == ["reading", "samples", "choice"]
    json.dumps(schema)


def test_extract_endpoint_schema_resolves_nested_references_without_mutation():
    payload = {
        "type": "object",
        "properties": {"reading": {"$ref": "#/components/schemas/Reading"}},
    }
    definitions = {"Reading": {"type": "number"}}
    original_payload = json.loads(json.dumps(payload))
    original_definitions = json.loads(json.dumps(definitions))

    schema_document = _schema_document(definitions)
    original_schema_document = json.loads(json.dumps(schema_document))

    extract_endpoint_schema(payload, schema_document)

    assert payload == original_payload
    assert definitions == original_definitions
    assert schema_document == original_schema_document


def test_extract_endpoint_schema_restores_random_number_generator_fields():
    definitions = {
        "RandomSettings": {
            "type": "object",
            "properties": {
                "seed": {
                    "anyOf": [{"type": "integer"}, {"type": "null"}],
                    "default": None,
                },
                "stream_id": {"type": "string", "default": "default"},
                "delay": {"type": "number", "default": 0},
            },
        },
        "RandomListSettings": {
            "type": "object",
            "properties": {
                "seed": {"$ref": "#/components/schemas/Seed"},
                "stream_id": {"type": "string", "default": "default"},
                "delay": {"type": "number", "default": 0},
                "count": {"type": "integer", "default": 1},
            },
        },
        "Seed": {
            "anyOf": [{"type": "integer"}, {"type": "null"}],
            "default": None,
        },
    }

    number_schema, number_values = extract_endpoint_schema(
        {"$ref": "#/components/schemas/RandomSettings"},
        _schema_document(definitions),
    )
    list_schema, list_values = extract_endpoint_schema(
        {"$ref": "#/components/schemas/RandomListSettings"},
        _schema_document(definitions),
        {"count": 20},
    )

    assert _value_names(number_values) == ["seed", "stream_id", "delay"]
    assert number_schema["properties"] == definitions["RandomSettings"]["properties"]
    assert _value_names(list_values) == ["seed", "stream_id", "delay", "count"]
    assert list_schema["properties"] == {
        "seed": {
            "anyOf": [{"type": "integer"}, {"type": "null"}],
            "default": None,
        },
        "stream_id": {"type": "string", "default": "default"},
        "delay": {"type": "number", "default": 0},
        "count": {"type": "integer", "default": 20},
    }


def test_extract_endpoint_schema_keeps_unresolved_reference_opaque():
    reference = {"$ref": "#/components/schemas/Missing"}

    schema, values = extract_endpoint_schema(reference, {})

    assert schema == {
        "type": "object",
        "properties": {"Missing": reference},
    }
    assert _value_names(values) == ["Missing"]


@pytest.mark.parametrize(
    ("payload", "definitions", "boundary_name", "boundary_ref"),
    [
        (
            {"$ref": "#/components/schemas/Node"},
            {"Node": {"$ref": "#/components/schemas/Node"}},
            "Node",
            "#/components/schemas/Node",
        ),
        (
            {"$ref": "#/components/schemas/A"},
            {
                "A": {"$ref": "#/components/schemas/B"},
                "B": {"$ref": "#/components/schemas/A"},
            },
            "A",
            "#/components/schemas/A",
        ),
    ],
    ids=["direct-cycle", "indirect-cycle"],
)
def test_extract_endpoint_schema_stops_at_reference_cycles(
    payload,
    definitions,
    boundary_name,
    boundary_ref,
):
    schema, values = extract_endpoint_schema(payload, _schema_document(definitions))

    assert schema == {
        "type": "object",
        "properties": {boundary_name: {"$ref": boundary_ref}},
    }
    assert _value_names(values) == [boundary_name]
    json.dumps(schema)


def test_extract_endpoint_schema_preserves_nested_cycle_boundary():
    definitions = {
        "Node": {
            "type": "object",
            "properties": {
                "value": {"type": "number"},
                "child": {"$ref": "#/components/schemas/Node"},
            },
        }
    }

    schema, values = extract_endpoint_schema(
        {"$ref": "#/components/schemas/Node"},
        _schema_document(definitions),
    )

    assert schema == {
        "type": "object",
        "properties": {
            "value": {"type": "number"},
            "child": {"$ref": "#/components/schemas/Node"},
        },
    }
    assert _value_names(values) == ["value", "child"]
    json.dumps(schema)
