import uuid

import pytest

from ihub_server.services.campaign_compilation import CampaignCompiler
from ihub_server.services.campaign_hydration import CampaignHydrator
from ihub_server.services.campaign_mapping import apply_edge_data_mappings
from ihub_server.services.errors import ServiceError, UnsupportedCampaignFormatError


def _task(task_id: str, **updates):
    task = {
        "id": task_id,
        "hierarchy": "capability",
        "capability": "Example",
        "operation_id": "run",
        "event_name": None,
        "input": None,
        "output": None,
        "task_dependencies": [],
        "task_objectives": None,
        "capability_metadata": None,
    }
    task.update(updates)
    return task


def _canonical_payload(*, cyclic: bool = False):
    first_group_id = str(uuid.uuid4())
    second_group_id = str(uuid.uuid4())
    return {
        "id": str(uuid.uuid4()),
        "run_id": str(uuid.uuid4()),
        "name": "Campaign",
        "user": "user@example.com",
        "description": "Compiler fixture",
        "task_groups": [
            {
                "id": second_group_id,
                "group_dependencies": [first_group_id],
                "tasks": [_task(str(uuid.uuid4()))],
                "objectives": [],
            },
            {
                "id": first_group_id,
                "group_dependencies": [second_group_id] if cyclic else [],
                "tasks": [_task(str(uuid.uuid4()))],
                "objectives": [],
            },
        ],
        "objectives": None,
        "inputs": [],
        "outputs": [],
    }


def test_compiler_refreshes_run_id_and_orders_canonical_groups():
    payload = _canonical_payload()
    persisted_run_id = payload["run_id"]

    campaign = CampaignCompiler(CampaignHydrator()).compile(payload)

    assert campaign.run_id != persisted_run_id
    assert campaign.task_groups[1].group_dependencies == [campaign.task_groups[0].id]


def test_compiler_detects_canonical_dependency_cycles():
    with pytest.raises(ServiceError, match="contain a cycle"):
        CampaignCompiler(CampaignHydrator()).compile(_canonical_payload(cyclic=True))


def test_compiler_defensively_removes_non_orchestrator_tasks_and_dependencies():
    compiler = CampaignCompiler(CampaignHydrator())
    executable_id = str(uuid.uuid4())
    renderer_id = str(uuid.uuid4())
    code_id = str(uuid.uuid4())
    payload = _canonical_payload()
    payload["task_groups"] = [
        {
            "id": str(uuid.uuid4()),
            "group_dependencies": [],
            "tasks": [
                _task(executable_id, task_dependencies=[renderer_id, code_id]),
                _task(renderer_id, hierarchy="renderer", capability="Renderer"),
                _task(code_id, hierarchy="code", capability="Code"),
            ],
            "objectives": [],
            "ui_edges": [{"source": executable_id, "target": renderer_id}],
        }
    ]

    campaign = compiler.compile(payload)

    assert [task.id for task in campaign.task_groups[0].tasks] == [executable_id]
    assert campaign.task_groups[0].tasks[0].task_dependencies == []


def test_mapping_reuses_source_value_id_and_removes_target_default():
    source = {"output": {"values": [{"id": "source-value", "var": "result"}]}}
    target = {
        "input": {
            "schema": {"properties": {"seed": {"default": 3}}},
            "values": [{"id": "target-value", "var": "seed"}],
        }
    }
    edge = {
        "source": "source",
        "target": "target",
        "sourceHandle": "output-right",
        "targetHandle": "input-left",
        "data": {"data_mapping": [{"source_parameter": "result", "target_parameter": "seed"}]},
    }

    apply_edge_data_mappings(edge, {"source": source, "target": target})

    assert target["input"]["values"][0]["id"] == "source-value"
    assert "default" not in target["input"]["schema"]["properties"]["seed"]


@pytest.mark.parametrize(
    "payload",
    [
        {"campaignId": "legacy", "nodes": [], "edges": []},
        {"name": "unknown"},
        {**_canonical_payload(), "campaignId": "legacy", "nodes": [], "edges": []},
    ],
)
def test_compiler_rejects_legacy_unknown_and_hybrid_documents(payload):
    with pytest.raises(
        UnsupportedCampaignFormatError,
        match="Legacy campaign format is no longer supported",
    ):
        CampaignCompiler(CampaignHydrator()).compile(payload)
