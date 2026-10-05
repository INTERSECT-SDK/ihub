"""Compilation of API campaign documents into orchestrator-ready models."""

import uuid
from typing import Any

from ihub_server.models.campaign import Campaign
from ihub_server.services.campaign_hydration import CampaignHydrator
from ihub_server.services.campaign_validation import validate_campaign_model_ids
from ihub_server.services.errors import ServiceError, UnsupportedCampaignFormatError

UNSUPPORTED_CAMPAIGN_FORMAT_MESSAGE = (
    "Legacy campaign format is no longer supported. Submit a CampaignModel document "
    "with task_groups."
)


class CampaignCompiler:
    """Compile a canonical CampaignModel payload for the orchestrator."""

    def __init__(self, hydrator: CampaignHydrator) -> None:
        """Initialize with the campaign metadata hydrator."""
        self._hydrator = hydrator

    def compile(
        self,
        payload: dict[str, Any],
    ) -> Campaign:
        """Return an orchestrator-ready Campaign from a CampaignModel payload."""
        legacy_markers = {"campaignId", "nodes", "edges"}
        if "task_groups" not in payload or legacy_markers.intersection(payload):
            raise UnsupportedCampaignFormatError(UNSUPPORTED_CAMPAIGN_FORMAT_MESSAGE)

        payload = self._with_fresh_run_id(payload)
        payload = self._strip_editor_only_tasks(payload)
        payload = self._hydrator.hydrate_model_payload_task_io(payload)
        task_hierarchy_by_id = self._hydrator.build_model_task_hierarchies(payload)
        campaign = Campaign.model_validate(payload)
        campaign = self._hydrator.apply_task_hierarchies(
            campaign,
            task_hierarchy_by_id,
        )
        validate_campaign_model_ids(campaign)
        return self._order_task_groups_by_dependency(campaign)

    @staticmethod
    def _with_fresh_run_id(payload: dict[str, Any]) -> dict[str, Any]:
        """Return a payload copy with a new run_id for each execution."""
        payload_with_new_run_id = dict(payload)
        payload_with_new_run_id["run_id"] = str(uuid.uuid4())
        return payload_with_new_run_id

    @staticmethod
    def _is_editor_only_task(task: dict[str, Any]) -> bool:
        """Return True when a model task represents a non-executable editor node."""
        hierarchy = task.get("hierarchy")
        capability = task.get("capability")

        non_executable_hierarchies = {
            "code",
            "visualization",
            "renderer",
            "json-file",
            "json-text",
        }
        non_executable_capabilities = {"code", "visualization", "renderer"}

        return (isinstance(hierarchy, str) and hierarchy.lower() in non_executable_hierarchies) or (
            isinstance(capability, str) and capability.lower() in non_executable_capabilities
        )

    def _strip_editor_only_tasks(
        self,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        """Remove non-executable editor tasks and their graph references."""
        sanitized_payload = dict(payload)
        raw_task_groups = payload.get("task_groups")
        if not isinstance(raw_task_groups, list):
            return sanitized_payload

        removed_task_ids: set[str] = set()
        sanitized_task_groups: list[dict[str, Any]] = []

        for task_group in raw_task_groups:
            if not isinstance(task_group, dict):
                continue

            raw_tasks = task_group.get("tasks")
            if not isinstance(raw_tasks, list):
                continue

            kept_tasks: list[dict[str, Any]] = []
            for task in raw_tasks:
                if not isinstance(task, dict):
                    continue

                if self._is_editor_only_task(task):
                    task_id = task.get("id")
                    if isinstance(task_id, str) and task_id:
                        removed_task_ids.add(task_id)
                    continue

                kept_tasks.append(dict(task))

            if not kept_tasks:
                continue

            sanitized_group = dict(task_group)
            sanitized_group["tasks"] = kept_tasks
            sanitized_task_groups.append(sanitized_group)

        if not sanitized_task_groups:
            msg = "Campaign has no executable tasks after removing editor-only tasks"
            raise ServiceError(msg)

        kept_group_ids = {
            task_group_id
            for task_group in sanitized_task_groups
            if isinstance(task_group.get("id"), str)
            for task_group_id in [task_group["id"]]
        }
        kept_task_ids = {
            task_id
            for task_group in sanitized_task_groups
            for task in task_group.get("tasks", [])
            if isinstance(task, dict) and isinstance(task.get("id"), str)
            for task_id in [task["id"]]
        }

        finalized_task_groups: list[dict[str, Any]] = []
        for task_group in sanitized_task_groups:
            finalized_group = dict(task_group)

            group_dependencies = task_group.get("group_dependencies")
            if isinstance(group_dependencies, list):
                finalized_group["group_dependencies"] = [
                    dependency_id
                    for dependency_id in group_dependencies
                    if isinstance(dependency_id, str) and dependency_id in kept_group_ids
                ]

            group_edges = task_group.get("ui_edges")
            if isinstance(group_edges, list):
                finalized_group["ui_edges"] = [
                    edge
                    for edge in group_edges
                    if isinstance(edge, dict)
                    and edge.get("source") not in removed_task_ids
                    and edge.get("target") not in removed_task_ids
                ]

            finalized_tasks: list[dict[str, Any]] = []
            for task in task_group.get("tasks", []):
                if not isinstance(task, dict):
                    continue

                finalized_task = dict(task)
                task_dependencies = task.get("task_dependencies")
                if isinstance(task_dependencies, list):
                    finalized_task["task_dependencies"] = [
                        dependency_id
                        for dependency_id in task_dependencies
                        if isinstance(dependency_id, str) and dependency_id in kept_task_ids
                    ]
                finalized_tasks.append(finalized_task)

            finalized_group["tasks"] = finalized_tasks
            finalized_task_groups.append(finalized_group)

        sanitized_payload["task_groups"] = finalized_task_groups
        return sanitized_payload

    def _order_task_groups_by_dependency(self, campaign: Campaign) -> Campaign:
        """Return campaign with task groups ordered topologically by group dependencies."""
        task_group_by_id = {task_group.id: task_group for task_group in campaign.task_groups}
        dependency_count = {task_group.id: 0 for task_group in campaign.task_groups}
        reverse_edges: dict[str, list[str]] = {
            task_group.id: [] for task_group in campaign.task_groups
        }

        for task_group in campaign.task_groups:
            for dependency_id in task_group.group_dependencies:
                dependency_count[task_group.id] += 1
                reverse_edges[dependency_id].append(task_group.id)

        ready_ids = [
            task_group.id
            for task_group in campaign.task_groups
            if dependency_count[task_group.id] == 0
        ]
        ordered_ids: list[str] = []

        while ready_ids:
            current_id = ready_ids.pop(0)
            ordered_ids.append(current_id)

            for dependent_id in reverse_edges[current_id]:
                dependency_count[dependent_id] -= 1
                if dependency_count[dependent_id] == 0:
                    ready_ids.append(dependent_id)

        if len(ordered_ids) != len(campaign.task_groups):
            unresolved_ids = [
                task_group_id
                for task_group_id, remaining in dependency_count.items()
                if remaining > 0
            ]
            msg = (
                "Task group dependencies contain a cycle or unresolved dependency chain: "
                f"{', '.join(unresolved_ids)}"
            )
            raise ServiceError(msg)

        ordered_task_groups = [task_group_by_id[task_group_id] for task_group_id in ordered_ids]
        return campaign.model_copy(update={"task_groups": ordered_task_groups})
