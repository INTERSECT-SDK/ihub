"""Pure validation rules for compiled campaign payloads."""

import uuid
from typing import Any

from ihub_server.models.campaign import Campaign
from ihub_server.services.errors import ServiceError


def is_uuidv4(value: str) -> bool:
    """Return whether a value is a canonical UUIDv4 string."""
    try:
        parsed = uuid.UUID(str(value))
    except ValueError:
        return False
    return parsed.version == 4 and str(parsed) == value


def validate_campaign_model_ids(campaign: Campaign) -> None:
    """Validate campaign, group, task, and dependency IDs without rewriting them."""
    if not is_uuidv4(campaign.id):
        msg = "Campaign model id must be a UUIDv4 string"
        raise ServiceError(msg)

    group_ids = {task_group.id for task_group in campaign.task_groups}
    task_ids = {task.id for task_group in campaign.task_groups for task in task_group.tasks}
    for task_group in campaign.task_groups:
        if not is_uuidv4(task_group.id):
            msg = f"Task group id must be a UUIDv4 string: {task_group.id}"
            raise ServiceError(msg)
        for dependency_id in task_group.group_dependencies:
            if not is_uuidv4(dependency_id):
                msg = f"Task group dependency id must be a UUIDv4 string: {dependency_id}"
                raise ServiceError(msg)
            if dependency_id not in group_ids:
                msg = f"Task group dependency id does not match any task group: {dependency_id}"
                raise ServiceError(msg)
        for task in task_group.tasks:
            if not is_uuidv4(task.id):
                msg = f"Task id must be a UUIDv4 string: {task.id}"
                raise ServiceError(msg)
            for dependency_id in task.task_dependencies:
                if not is_uuidv4(dependency_id):
                    msg = f"Task dependency id must be a UUIDv4 string: {dependency_id}"
                    raise ServiceError(msg)
                if dependency_id not in task_ids:
                    msg = f"Task dependency id does not match any task: {dependency_id}"
                    raise ServiceError(msg)


def validate_required_task_inputs(
    task_id: Any,
    input_payload: dict[str, Any] | None,
    manual_input: dict[str, Any],
    mapped_target_fields: set[str],
) -> None:
    """Reject required inputs without a manual, mapped, or default value."""
    if input_payload is None:
        return
    required_fields = input_payload.get("required")
    if not isinstance(required_fields, list):
        return
    properties = input_payload.get("properties")
    properties = properties if isinstance(properties, dict) else {}
    missing_fields = [
        field_name
        for field_name in required_fields
        if isinstance(field_name, str)
        and field_name
        and field_name not in manual_input
        and field_name not in mapped_target_fields
        and not (
            isinstance(properties.get(field_name), dict) and "default" in properties[field_name]
        )
    ]
    if missing_fields:
        msg = f"Task '{task_id}' is missing required input fields: {', '.join(missing_fields)}"
        raise ServiceError(msg)
