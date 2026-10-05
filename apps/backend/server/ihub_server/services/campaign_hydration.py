"""Campaign payload hierarchy and schema hydration."""

import logging
from typing import Any

from ihub_server.models.campaign import Campaign
from ihub_server.services.campaign_mapping import (
    apply_edge_data_mappings,
    mapped_target_fields_by_task_id,
)
from ihub_server.services.campaign_validation import validate_required_task_inputs
from ihub_server.services.errors import NotFoundError, ServiceError
from ihub_server.services.services import ServiceService
from ihub_server.utils.schema_extraction import (
    extract_endpoint_schema,
    extract_resolved_endpoint_schema,
    resolve_schema_references,
)

_log = logging.getLogger("ihub-server")


class CampaignHydrator:
    """Hydrate persisted campaign payloads with service discovery metadata."""

    def __init__(self, service_service: ServiceService | None = None) -> None:
        """Initialize with the narrow service-discovery dependency."""
        self._service_service = service_service

    def build_model_task_hierarchies(self, payload: dict[str, Any]) -> dict[str, str]:
        """Build normalized task-id -> service hierarchy mapping from Campaign model payload."""
        if not self._service_service:
            return {}

        task_hierarchies: dict[str, str] = {}
        hierarchy_by_service_id: dict[int, str] = {}
        hierarchy_by_service_name: dict[str, str] = {}

        for task_group in payload.get("task_groups", []):
            if not isinstance(task_group, dict):
                continue

            for task in task_group.get("tasks", []):
                if not isinstance(task, dict):
                    continue

                task_id = task.get("id")
                if not isinstance(task_id, str) or not task_id:
                    continue
                normalized_task_id = task_id

                service_id: int | None = None
                capability_metadata = task.get("capability_metadata")
                if isinstance(capability_metadata, dict):
                    raw_service_id = capability_metadata.get("service_id")
                    if isinstance(raw_service_id, int):
                        service_id = raw_service_id

                if service_id is not None:
                    if service_id not in hierarchy_by_service_id:
                        try:
                            service = self._service_service.get_service(service_id)
                            hierarchy_by_service_id[service_id] = str(service.hierarchy)
                        except NotFoundError:
                            _log.warning(
                                "Could not look up service %s for campaign model hierarchy",
                                service_id,
                            )
                    hierarchy = hierarchy_by_service_id.get(service_id)
                    if hierarchy:
                        task_hierarchies[normalized_task_id] = hierarchy
                    continue

                capability_name = task.get("capability")
                if isinstance(capability_name, str) and capability_name:
                    if capability_name not in hierarchy_by_service_name:
                        named_service = self._service_service.get_service_by_name(capability_name)
                        if named_service is not None:
                            hierarchy_by_service_name[capability_name] = str(
                                named_service.hierarchy
                            )
                    hierarchy = hierarchy_by_service_name.get(capability_name)
                    if hierarchy:
                        task_hierarchies[normalized_task_id] = hierarchy

        return task_hierarchies

    @staticmethod
    def _task_schema_document(task: dict[str, Any]) -> dict[str, Any]:
        """Extract the complete persisted endpoint schema document for a task."""
        capability_metadata = task.get("capability_metadata")
        if not isinstance(capability_metadata, dict):
            return {}
        endpoints_schema = capability_metadata.get("endpoints_schema")
        return endpoints_schema if isinstance(endpoints_schema, dict) else {}

    @staticmethod
    def _endpoint_payload(
        endpoint_channel: dict[str, Any],
        operation_name: str,
    ) -> dict[str, Any] | None:
        """Extract a publish or subscribe payload schema from an endpoint channel."""
        operation = endpoint_channel.get(operation_name)
        if not isinstance(operation, dict):
            return None
        message = operation.get("message")
        if not isinstance(message, dict):
            return None
        payload = message.get("payload")
        return payload if isinstance(payload, dict) else None

    def _hydrate_task_input(
        self,
        task: dict[str, Any],
        endpoint_channel: dict[str, Any],
        schema_document: dict[str, Any],
        mapped_target_fields: set[str],
    ) -> dict[str, Any] | None:
        """Build an orchestrator input definition for a campaign-model task."""
        task_id = task.get("id", "unknown")
        input_payload = self._endpoint_payload(endpoint_channel, "subscribe")
        resolved_input_payload = (
            resolve_schema_references(input_payload, schema_document)
            if input_payload is not None
            else None
        )
        manual_values = task.get("manual_input_values")
        manual_input = manual_values if isinstance(manual_values, dict) else {}
        input_schema, input_values = extract_resolved_endpoint_schema(
            resolved_input_payload,
            manual_input,
        )
        if input_schema is None:
            msg = f"Unable to parse input schema for task '{task_id}'"
            raise ServiceError(msg)

        validate_required_task_inputs(
            task_id,
            resolved_input_payload,
            manual_input,
            mapped_target_fields,
        )
        if not input_schema or not input_values:
            return None
        return {
            "schema": input_schema,
            "values": [value.model_dump() for value in input_values],
        }

    def _hydrate_task_output(
        self,
        task_id: Any,
        endpoint_channel: dict[str, Any],
        schema_document: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Build an orchestrator output definition for a campaign-model task."""
        output_payload = self._endpoint_payload(endpoint_channel, "publish")
        output_schema, output_values = extract_endpoint_schema(
            output_payload,
            schema_document,
        )
        if output_schema is None:
            msg = f"Unable to parse output schema for task '{task_id}'"
            raise ServiceError(msg)
        if not output_schema or not output_values:
            return None
        return {
            "schema": output_schema,
            "values": [value.model_dump() for value in output_values],
        }

    def _hydrate_model_task(
        self,
        task: dict[str, Any],
        mapped_target_fields: set[str],
    ) -> dict[str, Any]:
        """Populate missing input and output definitions for one model task."""
        hydrated_task = dict(task)
        event_name = task.get("event_name")
        if isinstance(event_name, str) and event_name and not task.get("operation_id"):
            hydrated_task["input"] = None
            if task.get("output") is None:
                capability_metadata = task.get("capability_metadata")
                endpoints_schema = (
                    capability_metadata.get("endpoints_schema")
                    if isinstance(capability_metadata, dict)
                    else None
                )
                events = (
                    endpoints_schema.get("events") if isinstance(endpoints_schema, dict) else None
                )
                event_definition = events.get(event_name) if isinstance(events, dict) else None
                if isinstance(event_definition, dict):
                    payload = event_definition.get("payload")
                    event_payload = payload if isinstance(payload, dict) else event_definition
                    output_schema, output_values = extract_endpoint_schema(
                        event_payload,
                        self._task_schema_document(task),
                    )
                    if output_schema and output_values:
                        hydrated_task["output"] = {
                            "schema": output_schema,
                            "values": [value.model_dump() for value in output_values],
                        }
            return hydrated_task

        endpoint_channel = task.get("endpoint_channel")
        if not isinstance(endpoint_channel, dict):
            return hydrated_task

        schema_document = self._task_schema_document(task)
        if task.get("input") is None:
            task_input = self._hydrate_task_input(
                task,
                endpoint_channel,
                schema_document,
                mapped_target_fields,
            )
            if task_input is not None:
                hydrated_task["input"] = task_input

        if task.get("output") is None:
            task_output = self._hydrate_task_output(
                task.get("id", "unknown"),
                endpoint_channel,
                schema_document,
            )
            if task_output is not None:
                hydrated_task["output"] = task_output
        return hydrated_task

    def _hydrate_model_task_group(self, task_group: dict[str, Any]) -> dict[str, Any]:
        """Hydrate task IO and mapped value identifiers for one model task group."""
        raw_edges = task_group.get("ui_edges")
        edges = raw_edges if isinstance(raw_edges, list) else []
        mapped_fields = mapped_target_fields_by_task_id(edges)
        hydrated_tasks: list[Any] = []
        for task in task_group.get("tasks", []):
            if not isinstance(task, dict):
                hydrated_tasks.append(task)
                continue
            task_id = task.get("id")
            task_mapped_fields = (
                mapped_fields.get(task_id, set()) if isinstance(task_id, str) else set()
            )
            hydrated_tasks.append(self._hydrate_model_task(task, task_mapped_fields))
        tasks_by_id = {
            task_id: task
            for task in hydrated_tasks
            if isinstance(task, dict) and isinstance((task_id := task.get("id")), str) and task_id
        }
        for edge in edges:
            apply_edge_data_mappings(edge, tasks_by_id)

        hydrated_task_group = dict(task_group)
        hydrated_task_group["tasks"] = hydrated_tasks
        return hydrated_task_group

    def hydrate_model_payload_task_io(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Populate missing task input/output from endpoint_channel schema metadata."""
        hydrated_payload = dict(payload)
        hydrated_payload["task_groups"] = [
            self._hydrate_model_task_group(task_group)
            if isinstance(task_group, dict)
            else task_group
            for task_group in payload.get("task_groups", [])
        ]
        return hydrated_payload

    def apply_task_hierarchies(
        self,
        campaign: Campaign,
        task_hierarchy_by_id: dict[str, str],
    ) -> Campaign:
        """Apply resolved service hierarchy values to campaign tasks by task id."""
        if not task_hierarchy_by_id:
            return campaign

        task_groups = []
        for task_group in campaign.task_groups:
            tasks = []
            for task in task_group.tasks:
                hierarchy = task_hierarchy_by_id.get(task.id)
                tasks.append(
                    task.model_copy(
                        update={"hierarchy": hierarchy if hierarchy else task.hierarchy}
                    )
                )
            task_groups.append(task_group.model_copy(update={"tasks": tasks}))

        return campaign.model_copy(update={"task_groups": task_groups})
