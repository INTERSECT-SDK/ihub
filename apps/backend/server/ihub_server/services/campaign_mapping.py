"""Pure CampaignModel data-mapping transformations."""

from typing import Any


def logical_mapping_task_ids(edge: dict[str, Any]) -> tuple[str, str] | None:
    """Return logical source and target task IDs for a horizontal UI edge."""
    source_id = edge.get("source")
    target_id = edge.get("target")
    if not isinstance(source_id, str) or not isinstance(target_id, str):
        return None
    handles = edge.get("sourceHandle"), edge.get("targetHandle")
    if handles == ("output-right", "input-left"):
        return source_id, target_id
    if handles == ("input-left", "output-right"):
        return target_id, source_id
    return None


def edge_data_mappings(edge: dict[str, Any]) -> list[Any]:
    """Return data mappings from an edge, or an empty list when malformed."""
    edge_data = edge.get("data")
    if not isinstance(edge_data, dict):
        return []
    data_mappings = edge_data.get("data_mapping")
    return data_mappings if isinstance(data_mappings, list) else []


def mapped_target_fields_by_task_id(edges: list[Any]) -> dict[str, set[str]]:
    """Collect mapped target fields, including their top-level roots, by task."""
    mapped_fields_by_task_id: dict[str, set[str]] = {}
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        task_ids = logical_mapping_task_ids(edge)
        if task_ids is None:
            continue
        mapped_fields = mapped_fields_by_task_id.setdefault(task_ids[1], set())
        for mapping in edge_data_mappings(edge):
            if not isinstance(mapping, dict):
                continue
            target_parameter = mapping.get("target_parameter")
            if isinstance(target_parameter, str) and target_parameter:
                mapped_fields.add(target_parameter)
                mapped_fields.add(target_parameter.split(".", 1)[0])
    return mapped_fields_by_task_id


def _values_by_var(values: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(values, list):
        return {}
    return {
        value_var: value
        for value in values
        if isinstance(value, dict)
        and isinstance((value_var := value.get("var")), str)
        and value_var
    }


def _resolve_mapping_value(
    values_by_var: dict[str, dict[str, Any]],
    parameter: str,
) -> tuple[dict[str, Any], str] | None:
    exact_value = values_by_var.get(parameter)
    if exact_value is not None:
        return exact_value, parameter
    if "." not in parameter:
        return None
    root_parameter = parameter.split(".", 1)[0]
    root_value = values_by_var.get(root_parameter)
    return (root_value, root_parameter) if root_value is not None else None


def _remove_schema_default(input_schema: dict[str, Any], mapped_var: str) -> None:
    properties = input_schema.get("properties")
    if not isinstance(properties, dict):
        return
    property_schema = properties.get(mapped_var)
    if isinstance(property_schema, dict):
        property_schema.pop("default", None)


def _apply_data_mapping(
    mapping: Any,
    source_outputs: dict[str, dict[str, Any]],
    target_inputs: dict[str, dict[str, Any]],
    input_schema: dict[str, Any],
) -> None:
    if not isinstance(mapping, dict):
        return
    source_parameter = mapping.get("source_parameter")
    target_parameter = mapping.get("target_parameter")
    if not isinstance(source_parameter, str) or not source_parameter:
        return
    if not isinstance(target_parameter, str) or not target_parameter:
        return
    source_match = _resolve_mapping_value(source_outputs, source_parameter)
    target_match = _resolve_mapping_value(target_inputs, target_parameter)
    if source_match is None or target_match is None:
        return
    source_value_id = source_match[0].get("id")
    if isinstance(source_value_id, str) and source_value_id:
        target_match[0]["id"] = source_value_id
        _remove_schema_default(input_schema, target_match[1])


def apply_edge_data_mappings(
    edge: Any,
    tasks_by_id: dict[str, dict[str, Any]],
) -> None:
    """Apply valid edge mappings to hydrated target task input metadata."""
    if not isinstance(edge, dict):
        return
    task_ids = logical_mapping_task_ids(edge)
    if task_ids is None:
        return
    source_task = tasks_by_id.get(task_ids[0])
    target_task = tasks_by_id.get(task_ids[1])
    if source_task is None or target_task is None:
        return
    source_output = source_task.get("output")
    target_input = target_task.get("input")
    if not isinstance(source_output, dict) or not isinstance(target_input, dict):
        return
    input_schema = target_input.get("schema")
    if not isinstance(input_schema, dict):
        return
    source_outputs = _values_by_var(source_output.get("values"))
    target_inputs = _values_by_var(target_input.get("values"))
    if not source_outputs or not target_inputs:
        return
    for mapping in edge_data_mappings(edge):
        _apply_data_mapping(mapping, source_outputs, target_inputs, input_schema)
