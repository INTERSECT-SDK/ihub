"""Extract flattened schema and variable entries from INTERSECT endpoint payloads.

This module recursively walks JSON Schema structures produced by the
INTERSECT SDK (``$ref``, ``allOf``, ``anyOf``/``oneOf``, ``enum``/``const``,
and all standard ``type`` values) and returns:

- an object-schema suitable for the campaign orchestrator, and
- a flat list of :class:`Value` entries for the campaign UI.

User-supplied manual values are injected as ``default`` entries so the
orchestrator picks them up when building task request payloads.
"""

import uuid
from typing import Any

from ..models.campaign import Value


def _decode_json_pointer_segment(segment: str) -> str | None:
    """Decode one RFC 6901 segment, rejecting malformed escape sequences."""
    index = 0
    while index < len(segment):
        if segment[index] != "~":
            index += 1
            continue
        if index + 1 >= len(segment) or segment[index + 1] not in {"0", "1"}:
            return None
        index += 2
    return segment.replace("~1", "/").replace("~0", "~")


def _resolve_local_json_pointer(ref_path: str, schema_document: Any) -> Any | None:
    """Resolve a local fragment JSON Pointer against the complete schema document."""
    if ref_path == "#":
        return schema_document
    if not ref_path.startswith("#/"):
        return None

    current = schema_document
    for encoded_segment in ref_path[2:].split("/"):
        segment = _decode_json_pointer_segment(encoded_segment)
        if segment is None:
            return None
        if isinstance(current, dict):
            if segment not in current:
                return None
            current = current[segment]
        elif isinstance(current, list):
            if not segment.isdecimal():
                return None
            index = int(segment)
            if index >= len(current):
                return None
            current = current[index]
        else:
            return None
    return current


def _resolve_schema_references(
    value: Any,
    schema_document: dict[str, Any],
    active_refs: frozenset[str],
) -> Any:
    """Return a JSON-compatible copy with local references resolved cycle-safely."""
    if isinstance(value, list):
        return [_resolve_schema_references(item, schema_document, active_refs) for item in value]
    if not isinstance(value, dict):
        return value

    ref_path = value.get("$ref")
    if isinstance(ref_path, str) and ref_path not in active_refs:
        resolved = _resolve_local_json_pointer(ref_path, schema_document)
        if resolved is not None:
            resolved_reference = _resolve_schema_references(
                resolved,
                schema_document,
                active_refs | {ref_path},
            )
            resolved_siblings = {
                key: _resolve_schema_references(item, schema_document, active_refs)
                for key, item in value.items()
                if key != "$ref"
            }
            if isinstance(resolved_reference, dict):
                return {**resolved_reference, **resolved_siblings}

    return {
        key: _resolve_schema_references(item, schema_document, active_refs)
        for key, item in value.items()
    }


def resolve_schema_references(value: Any, schema_document: dict[str, Any]) -> Any:
    """Return a copy with local references resolved against a complete document."""
    return _resolve_schema_references(value, schema_document, frozenset())


def _get_dynamic_var_name(
    schema: dict[str, Any],
) -> str:
    """Generate a variable name for dynamic properties (additionalProperties or patternProperties)."""
    # TODO - determine if this needs to be unique (fetching the title does not guarantee uniqueness)
    # if so, just dynamically generate a var name here
    return schema.get("title", "value")


def extract_endpoint_schema(
    payload: dict[str, Any] | None,
    schema_document: dict[str, Any],
    manual_values: dict[str, Any] | None = None,
) -> tuple[dict[str, Any] | None, list[Value]]:
    """Extract schema and flattened values from an INTERSECT endpoint payload.

    Recursively processes JSON Schema constructs (``$ref``, ``anyOf``,
    ``allOf``, ``enum``/``const``, ``type``) to produce a flat list of
    :class:`Value` entries for the campaign UI and an object schema with
    user-supplied *manual_values* injected as ``default`` entries.

    Works identically for both input (subscribe) and output (publish)
    payloads. References are resolved against the complete *schema_document*.
    Pass *manual_values* for inputs; leave it ``None`` for outputs.

    Returns:
        A 2-tuple ``(schema, values)`` where:

        - *schema* is ``{}`` when the endpoint legitimately has no
          payload, ``None`` if the payload could not be parsed, or a
          valid object-schema dict on success. "None" should be treated as an error by the caller.
        - *values* is a list of :class:`Value` entries.
    """
    if not payload:
        return {}, []
    resolved_payload = resolve_schema_references(payload, schema_document)
    return extract_resolved_endpoint_schema(resolved_payload, manual_values)


def extract_resolved_endpoint_schema(
    payload: dict[str, Any] | None,
    manual_values: dict[str, Any] | None = None,
) -> tuple[dict[str, Any] | None, list[Value]]:
    """Extract an endpoint schema after local references have been resolved."""
    if not payload:
        return {}, []
    return _walk_schema(payload, manual_values or {})


# -- recursive schema walker -------------------------------------------------


def _walk_schema(
    schema: dict[str, Any],
    manual: dict[str, Any],
) -> tuple[dict[str, Any] | None, list[Value]]:
    """Recursively walk a JSON Schema, collecting :class:`Value` entries."""
    # 1. $ref — retain unresolved or cyclic references as opaque boundaries
    if "$ref" in schema:
        ref_path = schema["$ref"]
        ref_name = ref_path.rsplit("/", 1)[-1] if isinstance(ref_path, str) else "reference"
        decoded_name = _decode_json_pointer_segment(ref_name)
        if decoded_name is not None:
            ref_name = decoded_name
        return (
            {"type": "object", "properties": {ref_name: schema}},
            [Value(id=str(uuid.uuid4()), var=ref_name)],
        )

    # 2. allOf — merge constituent schemas and re-walk
    if "allOf" in schema:
        allof_merged: dict[str, Any] = {}
        for sub in schema["allOf"]:
            allof_merged.update(sub)
        for k, v in schema.items():
            if k != "allOf":
                allof_merged[k] = v
        return _walk_schema(allof_merged, manual)

    # 3. anyOf / oneOf — take the first non-null variant
    variants = schema.get("anyOf") or schema.get("oneOf")
    if variants is not None:
        for sub in variants:
            if sub.get("type") != "null":
                return _walk_schema(sub, manual)
        return {}, []

    # 4. enum / const — finite value set, single variable
    if "enum" in schema or "const" in schema:
        var_name = _get_dynamic_var_name(schema)
        prop = dict(schema)
        if var_name in manual:
            prop["default"] = manual[var_name]
        return (
            {"type": "object", "properties": {var_name: prop}},
            [Value(id=str(uuid.uuid4()), var=var_name)],
        )

    # 5. type-based dispatch
    schema_type = schema.get("type")
    if schema_type in (None, "null"):
        # "null" has no meaningful payload; missing type is unparseable
        return ({}, []) if schema_type == "null" else (None, [])

    if schema_type == "object":
        return _walk_object(schema, manual)

    if schema_type == "array":
        return _walk_array(schema, manual)

    # Primitive types: string, integer, number, boolean
    var_name = _get_dynamic_var_name(schema)
    prop = dict(schema)
    if var_name in manual:
        prop["default"] = manual[var_name]
    return (
        {"type": "object", "properties": {var_name: prop}},
        [Value(id=str(uuid.uuid4()), var=var_name)],
    )


def _walk_object(
    schema: dict[str, Any],
    manual: dict[str, Any],
) -> tuple[dict[str, Any] | None, list[Value]]:
    """Handle ``type: object`` schemas.

    Checks ``properties``, ``additionalProperties`` and
    ``patternProperties`` in that order.
    """
    props: dict[str, Any] = {}
    values: list[Value] = []

    if "properties" in schema:
        for name, prop_schema in schema["properties"].items():
            prop = dict(prop_schema)
            if name in manual:
                prop["default"] = manual[name]
            props[name] = prop
            values.append(Value(id=str(uuid.uuid4()), var=name))

    # additionalProperties — dynamic dict (str keys)
    if "additionalProperties" in schema and isinstance(schema["additionalProperties"], dict):
        var_name = _get_dynamic_var_name(schema)
        if var_name not in props:
            entry = dict(schema)
            if var_name in manual:
                entry["default"] = manual[var_name]
            props[var_name] = entry
            values.append(Value(id=str(uuid.uuid4()), var=var_name))

    # patternProperties — dynamic dict (int/float keys)
    if "patternProperties" in schema:
        var_name = _get_dynamic_var_name(schema)
        if var_name not in props:
            entry = dict(schema)
            if var_name in manual:
                entry["default"] = manual[var_name]
            props[var_name] = entry
            values.append(Value(id=str(uuid.uuid4()), var=var_name))

    if not props:
        return {}, []

    return {"type": "object", "properties": props}, values


def _walk_array(
    schema: dict[str, Any],
    manual: dict[str, Any],
) -> tuple[dict[str, Any] | None, list[Value]]:
    """Handle ``type: array`` schemas.

    Both ``prefixItems`` (fixed-length tuple) and ``items``
    (variable-length list) are preserved in the schema for orchestrator
    validation; the whole array is exposed as a single :class:`Value`.
    """
    var_name = _get_dynamic_var_name(schema)
    prop = dict(schema)
    if var_name in manual:
        prop["default"] = manual[var_name]
    return (
        {"type": "object", "properties": {var_name: prop}},
        [Value(id=str(uuid.uuid4()), var=var_name)],
    )
