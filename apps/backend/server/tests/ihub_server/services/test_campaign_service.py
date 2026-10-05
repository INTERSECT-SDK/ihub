import asyncio
import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx
import pytest

from ihub_server.models import Broker
from ihub_server.models.broker import ProtocolEnum
from ihub_server.models.campaign_run import CampaignRunOutcome, CampaignRunStatus
from ihub_server.services import campaign as campaign_module
from ihub_server.services import campaign_transport as campaign_transport_module
from ihub_server.services.campaign import CampaignService
from ihub_server.services.errors import (
    NotFoundError,
    ServiceError,
    UnsupportedCampaignFormatError,
)


def _make_broker(orchestrator_url: str | None, orchestrator_api_key: str | None) -> Broker:
    return Broker(
        id=1,
        label="broker",
        host_ip="127.0.0.1",
        port="1883",
        protocol=ProtocolEnum.MQTT,
        username="user",
        password="pass",
        orchestrator_url=orchestrator_url,
        orchestrator_api_key=orchestrator_api_key,
        status="connected",
    )


class _FakeEventManager:
    def __init__(self):
        self.held_broker_ids = []
        self.relay_calls = []

    @asynccontextmanager
    async def hold_listener_for_start(self, broker_id):
        self.held_broker_ids.append(broker_id)
        yield

    async def relay_events(self, broker_id, websocket):
        self.relay_calls.append((broker_id, websocket))


class _FakeRunService:
    def __init__(self):
        self.created_runs = []
        self.deleted_runs = []
        self.transitioned_runs = []
        self.active_candidates = []
        self.active_run = SimpleNamespace(
            user_email="user@example.com",
            run_id="run-123",
            broker_id=1,
            status=CampaignRunStatus.ACTIVE,
        )

    def create_run(self, run):
        self.created_runs.append(run)
        return run

    def delete_active_run(self, run_id, broker_id, *, user_email=None):
        if self.active_run.status != CampaignRunStatus.ACTIVE:
            return False
        self.deleted_runs.append(
            {
                "run_id": run_id,
                "broker_id": broker_id,
                "user_email": user_email,
            }
        )
        return True

    def get_run_by_run_id(self, user_email, run_id):
        if self.active_run.user_email != user_email or self.active_run.run_id != run_id:
            raise NotFoundError("Campaign run not found.")
        return self.active_run

    def get_active_run_for_user(self, user_email, run_id, broker_id):
        if (
            self.active_run.user_email != user_email
            or self.active_run.run_id != run_id
            or self.active_run.broker_id != broker_id
            or self.active_run.status != CampaignRunStatus.ACTIVE
        ):
            raise NotFoundError("Active campaign run not found.")
        return self.active_run

    def transition_active_run(
        self,
        run_id,
        status,
        *,
        outcome=None,
        user_email=None,
        broker_id=None,
    ):
        self.transitioned_runs.append(
            {
                "run_id": run_id,
                "status": status,
                "outcome": outcome,
                "user_email": user_email,
                "broker_id": broker_id,
            }
        )
        return self.active_run

    def list_active_runs_by_campaign_and_broker(self, campaign_id, broker_id, limit=2):
        return self.active_candidates[:limit]


def test_start_campaign_missing_url(monkeypatch):
    broker_service = SimpleNamespace(get_broker=lambda _id: _make_broker(None, "key"))
    event_service = SimpleNamespace()
    service = CampaignService(broker_service, event_service)
    monkeypatch.setattr(service._compiler, "compile", lambda _payload: SimpleNamespace())

    with pytest.raises(NotFoundError):
        asyncio.run(service.start_campaign(1, {"campaign": "data"}, "user@example.com"))


def test_start_campaign_rejects_legacy_before_broker_or_run_side_effects():
    broker_service = SimpleNamespace(
        get_broker=lambda _id: (_ for _ in ()).throw(AssertionError("broker must not be loaded"))
    )
    run_service = _FakeRunService()
    service = CampaignService(
        broker_service,
        SimpleNamespace(),
        run_service=run_service,
        event_manager=_FakeEventManager(),
    )

    with pytest.raises(UnsupportedCampaignFormatError):
        asyncio.run(
            service.start_campaign(
                1,
                {"campaignId": "legacy", "nodes": [], "edges": []},
                "user@example.com",
            )
        )

    assert run_service.created_runs == []


def test_start_campaign_missing_key(monkeypatch):
    broker_service = SimpleNamespace(get_broker=lambda _id: _make_broker("http://url", None))
    event_service = SimpleNamespace()
    service = CampaignService(broker_service, event_service)
    monkeypatch.setattr(service._compiler, "compile", lambda _payload: SimpleNamespace())

    with pytest.raises(NotFoundError):
        asyncio.run(service.start_campaign(1, {"campaign": "data"}, "user@example.com"))


def test_start_campaign_success(monkeypatch):
    broker = _make_broker("http://orchestrator", "secret-key")
    broker_service = SimpleNamespace(get_broker=lambda _id: broker)
    event_service = SimpleNamespace()
    run_service = _FakeRunService()
    event_manager = _FakeEventManager()
    service = CampaignService(
        broker_service,
        event_service,
        run_service=run_service,
        event_manager=event_manager,
    )
    capture = {}

    class DummyCampaign:
        id = "saved-campaign"
        run_id = "run-123"
        name = "Saved Campaign"

        def model_dump(self, **kwargs):
            capture["model_dump_kwargs"] = kwargs
            return {"id": "saved-campaign", "run_id": "run-123"}

    monkeypatch.setattr(service._compiler, "compile", lambda _payload: DummyCampaign())

    class FakeResponse:
        def read(self):
            return b'{"status":"ok"}'

        def raise_for_status(self):
            return None

        def json(self):
            return {"status": "ok"}

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, headers=None, json=None):
            assert len(run_service.created_runs) == 1
            capture["url"] = url
            capture["headers"] = headers
            capture["json"] = json
            return FakeResponse()

    monkeypatch.setattr(
        campaign_transport_module.httpx,
        "AsyncClient",
        lambda: FakeAsyncClient(),
    )

    result = asyncio.run(service.start_campaign(1, {"campaign": "data"}, "user@example.com"))

    assert result == {
        "status": "ok",
        "campaign_id": "saved-campaign",
        "run_id": "run-123",
    }
    assert capture["url"].endswith("/v1/orchestrator/start_campaign")
    assert capture["headers"] == {
        "Authorization": "secret-key",
        "Content-Type": "application/json",
    }
    assert capture["json"] == {"id": "saved-campaign", "run_id": "run-123"}
    assert capture["model_dump_kwargs"] == {"by_alias": True}
    assert event_manager.held_broker_ids == [1]
    assert len(run_service.created_runs) == 1
    created_run = run_service.created_runs[0]
    assert created_run.user_email == "user@example.com"
    assert created_run.campaign_id == "saved-campaign"
    assert created_run.submitted_campaign_snapshot == {"campaign": "data"}
    assert created_run.orchestrator_campaign_snapshot == {
        "id": "saved-campaign",
        "run_id": "run-123",
    }
    assert created_run.run_id == "run-123"
    assert created_run.orchestrator_url == "http://orchestrator"
    assert created_run.campaign_name == "Saved Campaign"
    assert created_run.broker_id == 1
    assert created_run.status == CampaignRunStatus.ACTIVE


def test_start_campaign_accepts_orchestrator_campaign_payload(monkeypatch):
    broker = _make_broker("http://orchestrator", "secret-key")
    broker_service = SimpleNamespace(get_broker=lambda _id: broker)
    event_service = SimpleNamespace()
    fake_service = SimpleNamespace(hierarchy="demo.org.fac.sys.sub.Random_Number_Generator")
    service_service = SimpleNamespace(
        get_service=lambda service_id: fake_service if service_id == 123 else None,
        get_service_by_name=lambda _name: None,
    )
    run_service = _FakeRunService()
    event_manager = _FakeEventManager()
    service = CampaignService(
        broker_service,
        event_service,
        service_service=service_service,
        run_service=run_service,
        event_manager=event_manager,
    )

    payload_capture = {}

    class FakeResponse:
        def read(self):
            return b'{"status":"ok"}'

        def raise_for_status(self):
            return None

        def json(self):
            return {"status": "ok"}

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, headers=None, json=None):
            payload_capture["url"] = url
            payload_capture["headers"] = headers
            payload_capture["json"] = json
            return FakeResponse()

    monkeypatch.setattr(
        campaign_transport_module.httpx,
        "AsyncClient",
        lambda: FakeAsyncClient(),
    )

    campaign_id = str(uuid.uuid4())
    persisted_run_id = str(uuid.uuid4())
    task_group_uuid = str(uuid.uuid4())
    task_uuid = str(uuid.uuid4())
    orchestrator_campaign_payload = {
        "id": campaign_id,
        "run_id": persisted_run_id,
        "name": "Model Campaign",
        "user": "user@example.com",
        "description": "Campaign model payload",
        "task_groups": [
            {
                "id": task_group_uuid,
                "group_dependencies": [],
                "tasks": [
                    {
                        "id": task_uuid,
                        "hierarchy": "capability",
                        "capability": "demo-capability",
                        "operation_id": "run",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [],
                        "task_objectives": None,
                        "capability_metadata": {
                            "service_id": 123,
                        },
                        "ui_position": {"x": 10, "y": 20},
                    }
                ],
                "objectives": [],
                "ui_edges": [],
            }
        ],
        "objectives": None,
        "inputs": [],
        "outputs": [],
    }

    result = asyncio.run(
        service.start_campaign(1, orchestrator_campaign_payload, "user@example.com")
    )

    assert result == {
        "status": "ok",
        "campaign_id": campaign_id,
        "run_id": result["run_id"],
    }
    assert result["run_id"] != persisted_run_id
    assert uuid.UUID(result["run_id"]).version == 4
    assert payload_capture["url"].endswith("/v1/orchestrator/start_campaign")
    assert payload_capture["headers"] == {
        "Authorization": "secret-key",
        "Content-Type": "application/json",
    }
    assert payload_capture["json"]["id"] == campaign_id
    assert payload_capture["json"]["run_id"] == result["run_id"]
    assert payload_capture["json"]["task_groups"][0]["id"] == task_group_uuid
    assert payload_capture["json"]["task_groups"][0]["tasks"][0]["id"] == task_uuid
    assert (
        payload_capture["json"]["task_groups"][0]["tasks"][0]["hierarchy"]
        == "demo.org.fac.sys.sub.Random_Number_Generator"
    )
    assert len(run_service.created_runs) == 1
    created_run = run_service.created_runs[0]
    assert created_run.campaign_id == campaign_id
    assert created_run.run_id == result["run_id"]
    assert created_run.campaign_name == "Model Campaign"


def test_start_campaign_strips_visualization_tasks_and_edges_from_model_payload(
    monkeypatch,
):
    broker = _make_broker("http://orchestrator", "secret-key")
    broker_service = SimpleNamespace(get_broker=lambda _id: broker)
    event_service = SimpleNamespace()
    run_service = _FakeRunService()
    event_manager = _FakeEventManager()
    service = CampaignService(
        broker_service,
        event_service,
        service_service=SimpleNamespace(
            get_service=lambda _service_id: None,
            get_service_by_name=lambda _name: None,
        ),
        run_service=run_service,
        event_manager=event_manager,
    )

    payload_capture = {}

    class FakeResponse:
        def read(self):
            return b'{"status":"ok"}'

        def raise_for_status(self):
            return None

        def json(self):
            return {"status": "ok"}

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, _url, headers=None, json=None):
            payload_capture["json"] = json
            return FakeResponse()

    monkeypatch.setattr(
        campaign_transport_module.httpx,
        "AsyncClient",
        lambda: FakeAsyncClient(),
    )

    campaign_id = str(uuid.uuid4())
    group_id = str(uuid.uuid4())
    visualization_only_group_id = str(uuid.uuid4())
    downstream_group_id = str(uuid.uuid4())
    capability_source_task_id = str(uuid.uuid4())
    capability_target_task_id = str(uuid.uuid4())
    visualization_task_id = str(uuid.uuid4())
    visualization_only_task_id = str(uuid.uuid4())
    downstream_task_id = str(uuid.uuid4())

    payload = {
        "id": campaign_id,
        "run_id": str(uuid.uuid4()),
        "name": "Model Campaign",
        "user": "user@example.com",
        "description": "Campaign model payload",
        "task_groups": [
            {
                "id": group_id,
                "group_dependencies": [],
                "tasks": [
                    {
                        "id": capability_source_task_id,
                        "hierarchy": "capability",
                        "capability": "source-capability",
                        "operation_id": "produce",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [],
                        "task_objectives": None,
                        "endpoint_channel": {
                            "subscribe": {
                                "message": {"payload": {"type": "object", "properties": {}}}
                            },
                            "publish": {
                                "message": {
                                    "payload": {
                                        "type": "object",
                                        "properties": {
                                            "source_value": {"type": "number"},
                                        },
                                    }
                                }
                            },
                        },
                    },
                    {
                        "id": capability_target_task_id,
                        "hierarchy": "capability",
                        "capability": "target-capability",
                        "operation_id": "consume",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [capability_source_task_id, visualization_task_id],
                        "task_objectives": None,
                        "endpoint_channel": {
                            "subscribe": {
                                "message": {
                                    "payload": {
                                        "type": "object",
                                        "properties": {
                                            "target_value": {"type": "number"},
                                        },
                                    }
                                }
                            },
                            "publish": {
                                "message": {"payload": {"type": "object", "properties": {}}}
                            },
                        },
                    },
                    {
                        "id": visualization_task_id,
                        "hierarchy": "visualization",
                        "capability": "Visualization",
                        "operation_id": "viz",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [capability_source_task_id],
                        "task_objectives": None,
                    },
                ],
                "ui_edges": [
                    {
                        "source": capability_source_task_id,
                        "target": visualization_task_id,
                        "sourceHandle": "output-right",
                        "targetHandle": "input-left",
                    }
                ],
                "objectives": [],
            },
            {
                "id": visualization_only_group_id,
                "group_dependencies": [group_id],
                "tasks": [
                    {
                        "id": visualization_only_task_id,
                        "hierarchy": "visualization",
                        "capability": "Visualization",
                        "operation_id": "viz-only",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [capability_source_task_id],
                        "task_objectives": None,
                    }
                ],
                "ui_edges": [],
                "objectives": [],
            },
            {
                "id": downstream_group_id,
                "group_dependencies": [group_id, visualization_only_group_id],
                "tasks": [
                    {
                        "id": downstream_task_id,
                        "hierarchy": "capability",
                        "capability": "downstream-capability",
                        "operation_id": "run",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [
                            capability_target_task_id,
                            visualization_only_task_id,
                        ],
                        "task_objectives": None,
                        "endpoint_channel": {
                            "subscribe": {
                                "message": {"payload": {"type": "object", "properties": {}}}
                            },
                            "publish": {
                                "message": {"payload": {"type": "object", "properties": {}}}
                            },
                        },
                    }
                ],
                "ui_edges": [],
                "objectives": [],
            },
        ],
        "objectives": None,
        "inputs": [],
        "outputs": [],
    }

    _ = asyncio.run(service.start_campaign(1, payload, "user@example.com"))

    sent_campaign = payload_capture["json"]
    sent_group_ids = [task_group["id"] for task_group in sent_campaign["task_groups"]]
    assert visualization_only_group_id not in sent_group_ids

    sent_tasks = [
        task for task_group in sent_campaign["task_groups"] for task in task_group["tasks"]
    ]
    sent_task_ids = {task["id"] for task in sent_tasks}
    assert visualization_task_id not in sent_task_ids
    assert visualization_only_task_id not in sent_task_ids

    sent_target_task = next(task for task in sent_tasks if task["id"] == capability_target_task_id)
    assert sent_target_task["task_dependencies"] == [capability_source_task_id]

    sent_downstream_task = next(task for task in sent_tasks if task["id"] == downstream_task_id)
    assert sent_downstream_task["task_dependencies"] == [capability_target_task_id]

    sent_downstream_group = next(
        task_group
        for task_group in sent_campaign["task_groups"]
        if task_group["id"] == downstream_group_id
    )
    assert sent_downstream_group["group_dependencies"] == [group_id]

    sent_primary_group = next(
        task_group for task_group in sent_campaign["task_groups"] if task_group["id"] == group_id
    )
    assert sent_primary_group.get("ui_edges", []) == []


def test_start_campaign_preserves_complete_submission_and_compiles_executable_snapshot(
    monkeypatch,
):
    broker = _make_broker("http://orchestrator", "secret-key")
    run_service = _FakeRunService()
    service = CampaignService(
        SimpleNamespace(get_broker=lambda _id: broker),
        SimpleNamespace(),
        run_service=run_service,
        event_manager=_FakeEventManager(),
    )
    payload_capture = {}

    class FakeResponse:
        def read(self):
            return b'{"status":"ok"}'

        def raise_for_status(self):
            return None

        def json(self):
            return {"status": "ok"}

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, _url, headers=None, json=None):
            payload_capture["json"] = json
            return FakeResponse()

    monkeypatch.setattr(
        campaign_transport_module.httpx,
        "AsyncClient",
        lambda: FakeAsyncClient(),
    )

    campaign_id = str(uuid.uuid4())
    primary_group_id = str(uuid.uuid4())
    editor_group_id = str(uuid.uuid4())
    downstream_group_id = str(uuid.uuid4())
    code_task_id = str(uuid.uuid4())
    json_file_task_id = str(uuid.uuid4())
    json_text_task_id = str(uuid.uuid4())
    visualization_task_id = str(uuid.uuid4())
    renderer_task_id = str(uuid.uuid4())
    capability_task_id = str(uuid.uuid4())
    event_task_id = str(uuid.uuid4())
    downstream_task_id = str(uuid.uuid4())

    def editor_task(task_id, hierarchy, capability):
        return {
            "id": task_id,
            "hierarchy": hierarchy,
            "capability": capability,
            "operation_id": "editor",
            "event_name": None,
            "task_dependencies": [],
            "task_objectives": None,
            "ui_position": {"x": 10, "y": 20},
        }

    target_input_schema = {
        "type": "object",
        "properties": {
            "code_value": {"type": "number"},
            "file_value": {"type": "number"},
            "text_value": {"type": "string"},
        },
    }
    payload = {
        "id": campaign_id,
        "run_id": str(uuid.uuid4()),
        "name": "Complete Submitted Campaign",
        "user": "user@example.com",
        "description": "Preserve authored graph provenance",
        "task_groups": [
            {
                "id": primary_group_id,
                "group_dependencies": [],
                "tasks": [
                    editor_task(code_task_id, "code", "Code"),
                    editor_task(json_file_task_id, "json-file", "JSON File"),
                    editor_task(json_text_task_id, "json-text", "JSON Text"),
                    editor_task(
                        visualization_task_id,
                        "visualization",
                        "Visualization",
                    ),
                    editor_task(renderer_task_id, "renderer", "Renderer"),
                    {
                        "id": capability_task_id,
                        "hierarchy": "capability",
                        "capability": "Processor",
                        "operation_id": "process",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [
                            code_task_id,
                            json_file_task_id,
                            json_text_task_id,
                        ],
                        "task_objectives": None,
                        "manual_input_values": {
                            "code_value": 81,
                            "file_value": 72.5,
                            "text_value": "inline",
                        },
                        "endpoint_channel": {
                            "subscribe": {"message": {"payload": target_input_schema}},
                            "publish": {
                                "message": {"payload": {"type": "object", "properties": {}}}
                            },
                        },
                        "ui_position": {"x": 400, "y": 100},
                    },
                    {
                        "id": event_task_id,
                        "hierarchy": "events",
                        "capability": "Campaign Events",
                        "operation_id": None,
                        "event_name": "ready",
                        "event_mode": "once",
                        "event_count": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [capability_task_id, renderer_task_id],
                        "task_objectives": None,
                        "ui_position": {"x": 700, "y": 100},
                    },
                ],
                "objectives": [],
                "ui_edges": [
                    {
                        "id": f"{source_id}-target",
                        "source": source_id,
                        "target": capability_task_id,
                        "sourceHandle": "output-right",
                        "targetHandle": "input-left",
                    }
                    for source_id in (code_task_id, json_file_task_id, json_text_task_id)
                ]
                + [
                    {
                        "id": "capability-event",
                        "source": capability_task_id,
                        "target": event_task_id,
                        "sourceHandle": "bottom",
                        "targetHandle": "top",
                    }
                ],
                "ui_position": {"x": 100, "y": 100},
            },
            {
                "id": editor_group_id,
                "group_dependencies": [primary_group_id],
                "tasks": [editor_task(str(uuid.uuid4()), "visualization", "Visualization")],
                "objectives": [],
                "ui_edges": [],
                "ui_position": {"x": 500, "y": 500},
            },
            {
                "id": downstream_group_id,
                "group_dependencies": [primary_group_id, editor_group_id],
                "tasks": [
                    {
                        "id": downstream_task_id,
                        "hierarchy": "capability",
                        "capability": "Downstream",
                        "operation_id": "run",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [event_task_id, visualization_task_id],
                        "task_objectives": None,
                    }
                ],
                "objectives": [],
                "ui_edges": [],
            },
        ],
        "objectives": None,
        "inputs": [],
        "outputs": [],
    }

    asyncio.run(service.start_campaign(1, payload, "user@example.com"))

    created_run = run_service.created_runs[0]
    sent_campaign = payload_capture["json"]
    assert created_run.submitted_campaign_snapshot == payload
    assert created_run.orchestrator_campaign_snapshot == sent_campaign

    sent_groups = sent_campaign["task_groups"]
    assert [group["id"] for group in sent_groups] == [
        primary_group_id,
        downstream_group_id,
    ]
    assert sent_groups[1]["group_dependencies"] == [primary_group_id]

    sent_tasks = [task for group in sent_groups for task in group["tasks"]]
    sent_task_ids = {task["id"] for task in sent_tasks}
    assert sent_task_ids == {capability_task_id, event_task_id, downstream_task_id}
    for editor_task_id in (
        code_task_id,
        json_file_task_id,
        json_text_task_id,
        visualization_task_id,
        renderer_task_id,
    ):
        assert editor_task_id not in sent_task_ids

    sent_target = next(task for task in sent_tasks if task["id"] == capability_task_id)
    assert sent_target["task_dependencies"] == []
    assert sent_target["input"]["schema"]["properties"] == {
        "code_value": {"type": "number", "default": 81},
        "file_value": {"type": "number", "default": 72.5},
        "text_value": {"type": "string", "default": "inline"},
    }
    sent_event = next(task for task in sent_tasks if task["id"] == event_task_id)
    assert sent_event["event_name"] == "ready"
    assert sent_event["task_dependencies"] == [capability_task_id]
    sent_downstream = next(task for task in sent_tasks if task["id"] == downstream_task_id)
    assert sent_downstream["task_dependencies"] == [event_task_id]
    assert all("ui_edges" not in group for group in sent_groups)


def test_start_campaign_strips_renderer_tasks_from_model_payload(
    monkeypatch,
):
    broker = _make_broker("http://orchestrator", "secret-key")
    broker_service = SimpleNamespace(get_broker=lambda _id: broker)
    event_service = SimpleNamespace()
    run_service = _FakeRunService()
    event_manager = _FakeEventManager()
    service = CampaignService(
        broker_service,
        event_service,
        service_service=SimpleNamespace(
            get_service=lambda _service_id: None,
            get_service_by_name=lambda _name: None,
        ),
        run_service=run_service,
        event_manager=event_manager,
    )

    payload_capture = {}

    class FakeResponse:
        def read(self):
            return b'{"status":"ok"}'

        def raise_for_status(self):
            return None

        def json(self):
            return {"status": "ok"}

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, _url, headers=None, json=None):
            payload_capture["json"] = json
            return FakeResponse()

    monkeypatch.setattr(
        campaign_transport_module.httpx,
        "AsyncClient",
        lambda: FakeAsyncClient(),
    )

    campaign_id = str(uuid.uuid4())
    group_id = str(uuid.uuid4())
    capability_task_id = str(uuid.uuid4())
    renderer_task_id = str(uuid.uuid4())

    payload = {
        "id": campaign_id,
        "run_id": str(uuid.uuid4()),
        "name": "Model Campaign with Renderer",
        "user": "user@example.com",
        "description": "Campaign model payload",
        "task_groups": [
            {
                "id": group_id,
                "group_dependencies": [],
                "tasks": [
                    {
                        "id": capability_task_id,
                        "hierarchy": "capability",
                        "capability": "source-capability",
                        "operation_id": "produce",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [],
                        "task_objectives": None,
                        "endpoint_channel": {
                            "subscribe": {
                                "message": {"payload": {"type": "object", "properties": {}}}
                            },
                            "publish": {
                                "message": {
                                    "payload": {
                                        "type": "object",
                                        "properties": {
                                            "source_value": {"type": "number"},
                                        },
                                    }
                                }
                            },
                        },
                    },
                    {
                        "id": renderer_task_id,
                        "hierarchy": "renderer",
                        "capability": "Renderer",
                        "operation_id": "image-renderer",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [capability_task_id],
                        "task_objectives": None,
                    },
                ],
                "ui_edges": [
                    {
                        "source": capability_task_id,
                        "target": renderer_task_id,
                        "sourceHandle": "output-right",
                        "targetHandle": "input-left",
                    }
                ],
                "objectives": [],
            },
        ],
        "objectives": None,
        "inputs": [],
        "outputs": [],
    }

    _ = asyncio.run(service.start_campaign(1, payload, "user@example.com"))

    sent_campaign = payload_capture["json"]
    sent_tasks = [
        task for task_group in sent_campaign["task_groups"] for task in task_group["tasks"]
    ]
    sent_task_ids = {task["id"] for task in sent_tasks}
    assert renderer_task_id not in sent_task_ids
    assert capability_task_id in sent_task_ids


def test_start_campaign_assigns_new_run_id_each_model_execution(monkeypatch):
    broker = _make_broker("http://orchestrator", "secret-key")
    broker_service = SimpleNamespace(get_broker=lambda _id: broker)
    event_service = SimpleNamespace()
    run_service = _FakeRunService()
    event_manager = _FakeEventManager()
    service = CampaignService(
        broker_service,
        event_service,
        service_service=SimpleNamespace(
            get_service=lambda _service_id: None,
            get_service_by_name=lambda _name: None,
        ),
        run_service=run_service,
        event_manager=event_manager,
    )

    class FakeResponse:
        def read(self):
            return b'{"status":"ok"}'

        def raise_for_status(self):
            return None

        def json(self):
            return {"status": "ok"}

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, _url, headers=None, json=None):
            return FakeResponse()

    monkeypatch.setattr(
        campaign_transport_module.httpx,
        "AsyncClient",
        lambda: FakeAsyncClient(),
    )

    campaign_id = str(uuid.uuid4())
    task_group_id = str(uuid.uuid4())
    task_id = str(uuid.uuid4())
    payload = {
        "id": campaign_id,
        "run_id": str(uuid.uuid4()),
        "name": "Model Campaign",
        "user": "user@example.com",
        "description": "Campaign model payload",
        "task_groups": [
            {
                "id": task_group_id,
                "group_dependencies": [],
                "tasks": [
                    {
                        "id": task_id,
                        "hierarchy": "capability",
                        "capability": "demo-capability",
                        "operation_id": "run",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [],
                        "task_objectives": None,
                    }
                ],
                "objectives": [],
            }
        ],
        "objectives": None,
        "inputs": [],
        "outputs": [],
    }

    first = asyncio.run(service.start_campaign(1, payload, "user@example.com"))
    second = asyncio.run(service.start_campaign(1, payload, "user@example.com"))

    assert first["campaign_id"] == campaign_id
    assert second["campaign_id"] == campaign_id
    assert first["run_id"] != second["run_id"]
    assert uuid.UUID(first["run_id"]).version == 4
    assert uuid.UUID(second["run_id"]).version == 4


def test_start_campaign_orders_model_task_groups_by_dependencies(monkeypatch):
    broker = _make_broker("http://orchestrator", "secret-key")
    broker_service = SimpleNamespace(get_broker=lambda _id: broker)
    event_service = SimpleNamespace()
    run_service = _FakeRunService()
    event_manager = _FakeEventManager()
    service = CampaignService(
        broker_service,
        event_service,
        service_service=SimpleNamespace(
            get_service=lambda _service_id: None,
            get_service_by_name=lambda _name: None,
        ),
        run_service=run_service,
        event_manager=event_manager,
    )

    payload_capture = {}

    class FakeResponse:
        def read(self):
            return b'{"status":"ok"}'

        def raise_for_status(self):
            return None

        def json(self):
            return {"status": "ok"}

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, _url, headers=None, json=None):
            payload_capture["json"] = json
            return FakeResponse()

    monkeypatch.setattr(
        campaign_transport_module.httpx,
        "AsyncClient",
        lambda: FakeAsyncClient(),
    )

    campaign_id = str(uuid.uuid4())
    upstream_group_id = str(uuid.uuid4())
    downstream_group_id = str(uuid.uuid4())
    downstream_task_id = str(uuid.uuid4())
    upstream_task_id = str(uuid.uuid4())

    payload = {
        "id": campaign_id,
        "run_id": str(uuid.uuid4()),
        "name": "Model Campaign",
        "user": "user@example.com",
        "description": "Campaign model payload",
        "task_groups": [
            {
                "id": downstream_group_id,
                "group_dependencies": [upstream_group_id],
                "tasks": [
                    {
                        "id": downstream_task_id,
                        "hierarchy": "capability",
                        "capability": "downstream",
                        "operation_id": "run",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [],
                        "task_objectives": None,
                    }
                ],
                "objectives": [],
            },
            {
                "id": upstream_group_id,
                "group_dependencies": [],
                "tasks": [
                    {
                        "id": upstream_task_id,
                        "hierarchy": "capability",
                        "capability": "upstream",
                        "operation_id": "run",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [],
                        "task_objectives": None,
                    }
                ],
                "objectives": [],
            },
        ],
        "objectives": None,
        "inputs": [],
        "outputs": [],
    }

    _ = asyncio.run(service.start_campaign(1, payload, "user@example.com"))

    sent_group_ids = [task_group["id"] for task_group in payload_capture["json"]["task_groups"]]
    assert sent_group_ids == [upstream_group_id, downstream_group_id]


def test_start_campaign_rejects_model_task_group_dependency_cycles():
    broker = _make_broker("http://orchestrator", "secret-key")
    broker_service = SimpleNamespace(get_broker=lambda _id: broker)
    event_service = SimpleNamespace()
    service = CampaignService(
        broker_service,
        event_service,
        service_service=SimpleNamespace(
            get_service=lambda _service_id: None,
            get_service_by_name=lambda _name: None,
        ),
        run_service=_FakeRunService(),
        event_manager=_FakeEventManager(),
    )

    group_a_id = str(uuid.uuid4())
    group_b_id = str(uuid.uuid4())

    payload = {
        "id": str(uuid.uuid4()),
        "run_id": str(uuid.uuid4()),
        "name": "Model Campaign",
        "user": "user@example.com",
        "description": "Campaign model payload",
        "task_groups": [
            {
                "id": group_a_id,
                "group_dependencies": [group_b_id],
                "tasks": [
                    {
                        "id": str(uuid.uuid4()),
                        "hierarchy": "capability",
                        "capability": "a",
                        "operation_id": "run",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [],
                        "task_objectives": None,
                    }
                ],
                "objectives": [],
            },
            {
                "id": group_b_id,
                "group_dependencies": [group_a_id],
                "tasks": [
                    {
                        "id": str(uuid.uuid4()),
                        "hierarchy": "capability",
                        "capability": "b",
                        "operation_id": "run",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [],
                        "task_objectives": None,
                    }
                ],
                "objectives": [],
            },
        ],
        "objectives": None,
        "inputs": [],
        "outputs": [],
    }

    with pytest.raises(ServiceError, match="Task group dependencies contain a cycle"):
        asyncio.run(service.start_campaign(1, payload, "user@example.com"))


def test_start_campaign_rejects_orchestrator_campaign_payload_with_non_uuid_ids():
    broker = _make_broker("http://orchestrator", "secret-key")
    broker_service = SimpleNamespace(get_broker=lambda _id: broker)
    event_service = SimpleNamespace()
    service = CampaignService(
        broker_service,
        event_service,
        service_service=SimpleNamespace(
            get_service=lambda _service_id: None,
            get_service_by_name=lambda _name: None,
        ),
        run_service=_FakeRunService(),
        event_manager=_FakeEventManager(),
    )

    persisted_run_id = str(uuid.uuid4())
    invalid_payload = {
        "id": "campaign-model-1",
        "run_id": persisted_run_id,
        "name": "Model Campaign",
        "user": "user@example.com",
        "description": "Campaign model payload",
        "task_groups": [
            {
                "id": "task-group-1",
                "group_dependencies": [],
                "tasks": [
                    {
                        "id": "task-1",
                        "hierarchy": "capability",
                        "capability": "demo-capability",
                        "operation_id": "run",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [],
                        "task_objectives": None,
                    }
                ],
                "objectives": [],
            }
        ],
        "objectives": None,
        "inputs": [],
        "outputs": [],
    }

    with pytest.raises(ServiceError, match="Campaign model id must be a UUIDv4 string"):
        asyncio.run(service.start_campaign(1, invalid_payload, "user@example.com"))


def test_start_campaign_hydrates_model_task_input_output_from_endpoint_channel(monkeypatch):
    broker = _make_broker("http://orchestrator", "secret-key")
    broker_service = SimpleNamespace(get_broker=lambda _id: broker)
    event_service = SimpleNamespace()
    run_service = _FakeRunService()
    event_manager = _FakeEventManager()
    service = CampaignService(
        broker_service,
        event_service,
        service_service=SimpleNamespace(
            get_service=lambda _service_id: None,
            get_service_by_name=lambda _name: None,
        ),
        run_service=run_service,
        event_manager=event_manager,
    )

    payload_capture = {}

    class FakeResponse:
        def read(self):
            return b'{"status":"ok"}'

        def raise_for_status(self):
            return None

        def json(self):
            return {"status": "ok"}

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, _url, headers=None, json=None):
            payload_capture["headers"] = headers
            payload_capture["json"] = json
            return FakeResponse()

    monkeypatch.setattr(
        campaign_transport_module.httpx,
        "AsyncClient",
        lambda: FakeAsyncClient(),
    )

    campaign_id = str(uuid.uuid4())
    persisted_run_id = str(uuid.uuid4())
    task_group_id = str(uuid.uuid4())
    task_id = str(uuid.uuid4())
    payload = {
        "id": campaign_id,
        "run_id": persisted_run_id,
        "name": "Model Campaign",
        "user": "user@example.com",
        "description": "Campaign model payload",
        "task_groups": [
            {
                "id": task_group_id,
                "group_dependencies": [],
                "tasks": [
                    {
                        "id": task_id,
                        "hierarchy": "demo.org.fac.sys.sub.Random_Number_Generator",
                        "capability": "Random_Number_Generator",
                        "operation_id": "generate_random_number",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [],
                        "task_objectives": None,
                        "manual_input_values": {
                            "seed": 7,
                        },
                        "endpoint_channel": {
                            "subscribe": {
                                "message": {
                                    "payload": {
                                        "type": "object",
                                        "properties": {
                                            "seed": {
                                                "type": "integer",
                                            }
                                        },
                                    }
                                }
                            },
                            "publish": {
                                "message": {
                                    "payload": {
                                        "type": "object",
                                        "properties": {
                                            "random_number": {
                                                "type": "number",
                                            }
                                        },
                                    }
                                }
                            },
                        },
                    }
                ],
                "objectives": [],
            }
        ],
        "objectives": None,
        "inputs": [],
        "outputs": [],
    }

    result = asyncio.run(service.start_campaign(1, payload, "user@example.com"))

    assert result == {
        "status": "ok",
        "campaign_id": campaign_id,
        "run_id": result["run_id"],
    }
    assert result["run_id"] != persisted_run_id
    assert uuid.UUID(result["run_id"]).version == 4
    sent_task = payload_capture["json"]["task_groups"][0]["tasks"][0]
    assert sent_task["input"] is not None
    assert sent_task["output"] is not None
    assert sent_task["input"]["schema"]["properties"]["seed"]["default"] == 7
    assert sent_task["output"]["schema"]["properties"]["random_number"]["type"] == "number"


def test_start_campaign_model_ui_edge_data_mapping_binds_downstream_input(monkeypatch):
    broker = _make_broker("http://orchestrator", "secret-key")
    broker_service = SimpleNamespace(get_broker=lambda _id: broker)
    event_service = SimpleNamespace()
    run_service = _FakeRunService()
    event_manager = _FakeEventManager()
    service = CampaignService(
        broker_service,
        event_service,
        service_service=SimpleNamespace(
            get_service=lambda _service_id: None,
            get_service_by_name=lambda _name: None,
        ),
        run_service=run_service,
        event_manager=event_manager,
    )

    payload_capture = {}

    class FakeResponse:
        def read(self):
            return b'{"status":"ok"}'

        def raise_for_status(self):
            return None

        def json(self):
            return {"status": "ok"}

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, _url, headers=None, json=None):
            payload_capture["json"] = json
            return FakeResponse()

    monkeypatch.setattr(
        campaign_transport_module.httpx,
        "AsyncClient",
        lambda: FakeAsyncClient(),
    )

    campaign_id = str(uuid.uuid4())
    task_group_id = str(uuid.uuid4())
    source_task_id = str(uuid.uuid4())
    target_task_id = str(uuid.uuid4())

    payload = {
        "id": campaign_id,
        "run_id": str(uuid.uuid4()),
        "name": "Model Campaign",
        "user": "user@example.com",
        "description": "Campaign model payload",
        "task_groups": [
            {
                "id": task_group_id,
                "group_dependencies": [],
                "tasks": [
                    {
                        "id": source_task_id,
                        "hierarchy": "capability",
                        "capability": "source-capability",
                        "operation_id": "produce",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [],
                        "task_objectives": None,
                        "endpoint_channel": {
                            "publish": {
                                "message": {
                                    "payload": {
                                        "type": "object",
                                        "properties": {
                                            "source_value": {"type": "number"},
                                        },
                                    }
                                }
                            },
                            "subscribe": {
                                "message": {
                                    "payload": {
                                        "type": "object",
                                        "properties": {},
                                    }
                                }
                            },
                        },
                    },
                    {
                        "id": target_task_id,
                        "hierarchy": "capability",
                        "capability": "target-capability",
                        "operation_id": "consume",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [source_task_id],
                        "task_objectives": None,
                        "endpoint_channel": {
                            "publish": {
                                "message": {
                                    "payload": {
                                        "type": "object",
                                        "properties": {},
                                    }
                                }
                            },
                            "subscribe": {
                                "message": {
                                    "payload": {
                                        "type": "object",
                                        "required": ["target_value"],
                                        "properties": {
                                            "target_value": {"type": "number"},
                                        },
                                    }
                                }
                            },
                        },
                    },
                ],
                "ui_edges": [
                    {
                        "source": source_task_id,
                        "target": target_task_id,
                        "sourceHandle": "output-right",
                        "targetHandle": "input-left",
                        "data": {
                            "data_mapping": [
                                {
                                    "source_parameter": "source_value",
                                    "target_parameter": "target_value",
                                }
                            ]
                        },
                    }
                ],
                "objectives": [],
            }
        ],
        "objectives": None,
        "inputs": [],
        "outputs": [],
    }

    _ = asyncio.run(service.start_campaign(1, payload, "user@example.com"))

    sent_tasks = payload_capture["json"]["task_groups"][0]["tasks"]
    sent_source_task = next(task for task in sent_tasks if task["id"] == source_task_id)
    sent_target_task = next(task for task in sent_tasks if task["id"] == target_task_id)

    source_value_id = sent_source_task["output"]["values"][0]["id"]
    target_value_id = sent_target_task["input"]["values"][0]["id"]

    assert source_value_id == target_value_id


def test_start_campaign_model_ui_edge_dotted_target_mapping_satisfies_required_field(
    monkeypatch,
):
    broker = _make_broker("http://orchestrator", "secret-key")
    broker_service = SimpleNamespace(get_broker=lambda _id: broker)
    event_service = SimpleNamespace()
    run_service = _FakeRunService()
    event_manager = _FakeEventManager()
    service = CampaignService(
        broker_service,
        event_service,
        service_service=SimpleNamespace(
            get_service=lambda _service_id: None,
            get_service_by_name=lambda _name: None,
        ),
        run_service=run_service,
        event_manager=event_manager,
    )

    payload_capture = {}

    class FakeResponse:
        def read(self):
            return b'{"status":"ok"}'

        def raise_for_status(self):
            return None

        def json(self):
            return {"status": "ok"}

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, _url, headers=None, json=None):
            payload_capture["json"] = json
            return FakeResponse()

    monkeypatch.setattr(campaign_transport_module.httpx, "AsyncClient", FakeAsyncClient)

    campaign_id = str(uuid.uuid4())
    task_group_id = str(uuid.uuid4())
    source_task_id = str(uuid.uuid4())
    target_task_id = str(uuid.uuid4())

    payload = {
        "id": campaign_id,
        "run_id": str(uuid.uuid4()),
        "name": "Model Campaign",
        "user": "user@example.com",
        "description": "Campaign model payload",
        "task_groups": [
            {
                "id": task_group_id,
                "group_dependencies": [],
                "tasks": [
                    {
                        "id": source_task_id,
                        "hierarchy": "capability",
                        "capability": "source-capability",
                        "operation_id": "produce",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [],
                        "task_objectives": None,
                        "endpoint_channel": {
                            "publish": {
                                "message": {
                                    "payload": {
                                        "type": "object",
                                        "properties": {
                                            "source_value": {"type": "number"},
                                        },
                                    }
                                }
                            },
                            "subscribe": {
                                "message": {
                                    "payload": {
                                        "type": "object",
                                        "properties": {},
                                    }
                                }
                            },
                        },
                    },
                    {
                        "id": target_task_id,
                        "hierarchy": "capability",
                        "capability": "target-capability",
                        "operation_id": "consume",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [source_task_id],
                        "task_objectives": None,
                        "endpoint_channel": {
                            "publish": {
                                "message": {
                                    "payload": {
                                        "type": "object",
                                        "properties": {},
                                    }
                                }
                            },
                            "subscribe": {
                                "message": {
                                    "payload": {
                                        "type": "object",
                                        "required": ["target_value"],
                                        "properties": {
                                            "target_value": {"type": "number"},
                                        },
                                    }
                                }
                            },
                        },
                    },
                ],
                "ui_edges": [
                    {
                        "source": source_task_id,
                        "target": target_task_id,
                        "sourceHandle": "output-right",
                        "targetHandle": "input-left",
                        "data": {
                            "data_mapping": [
                                {
                                    "source_parameter": "source_value",
                                    "target_parameter": "target_value.value",
                                }
                            ]
                        },
                    }
                ],
                "objectives": [],
            }
        ],
        "objectives": None,
        "inputs": [],
        "outputs": [],
    }

    _ = asyncio.run(service.start_campaign(1, payload, "user@example.com"))

    sent_tasks = payload_capture["json"]["task_groups"][0]["tasks"]
    sent_source_task = next(task for task in sent_tasks if task["id"] == source_task_id)
    sent_target_task = next(task for task in sent_tasks if task["id"] == target_task_id)

    source_value_id = sent_source_task["output"]["values"][0]["id"]
    target_value_id = sent_target_task["input"]["values"][0]["id"]

    assert source_value_id == target_value_id


@pytest.mark.parametrize("referenced_contract", [False, True], ids=["inline", "referenced"])
def test_start_campaign_rejects_model_task_missing_required_input_fields(
    referenced_contract,
):
    broker = _make_broker("http://orchestrator", "secret-key")
    broker_service = SimpleNamespace(get_broker=lambda _id: broker)
    event_service = SimpleNamespace()
    service = CampaignService(
        broker_service,
        event_service,
        service_service=SimpleNamespace(
            get_service=lambda _service_id: None,
            get_service_by_name=lambda _name: None,
        ),
        run_service=_FakeRunService(),
        event_manager=_FakeEventManager(),
    )

    campaign_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    task_group_id = str(uuid.uuid4())
    task_id = str(uuid.uuid4())
    input_schema = {
        "type": "object",
        "required": [
            "api_url",
            "project_id",
            "file_name",
            "ihub_email",
        ],
        "properties": {
            "api_url": {"type": "string"},
            "project_id": {"type": "string"},
            "file_name": {"type": "string"},
            "ihub_email": {"type": "string"},
            "content": {"type": "string"},
            "token": {"type": "string"},
        },
    }
    endpoints_schema = {"components": {"schemas": {"SaveFileInput": input_schema}}}
    input_payload = (
        {"$ref": "#/components/schemas/SaveFileInput"} if referenced_contract else input_schema
    )
    payload = {
        "id": campaign_id,
        "run_id": run_id,
        "name": "Model Campaign",
        "user": "user@example.com",
        "description": "Campaign model payload",
        "task_groups": [
            {
                "id": task_group_id,
                "group_dependencies": [],
                "tasks": [
                    {
                        "id": task_id,
                        "hierarchy": "file-organization.file-facility.file-system.file-subsystem.file-service",
                        "capability": "FileService",
                        "operation_id": "save_file",
                        "event_name": None,
                        "input": None,
                        "output": None,
                        "task_dependencies": [],
                        "task_objectives": None,
                        "manual_input_values": {
                            "content": "test",
                            "token": None,
                        },
                        "capability_metadata": {
                            "endpoints_schema": endpoints_schema,
                        },
                        "endpoint_channel": {
                            "subscribe": {
                                "message": {
                                    "payload": input_payload,
                                }
                            },
                            "publish": {
                                "message": {
                                    "payload": {
                                        "type": "object",
                                        "properties": {
                                            "status": {"type": "string"},
                                        },
                                    }
                                }
                            },
                        },
                    }
                ],
                "objectives": [],
            }
        ],
        "objectives": None,
        "inputs": [],
        "outputs": [],
    }

    with pytest.raises(
        ServiceError,
        match=("missing required input fields: api_url, project_id, file_name, ihub_email"),
    ):
        asyncio.run(service.start_campaign(1, payload, "user@example.com"))


@pytest.mark.parametrize("racing_terminal", [False, True])
def test_start_campaign_http_error(monkeypatch, racing_terminal):
    broker = _make_broker("http://orchestrator", "secret-key")
    broker_service = SimpleNamespace(get_broker=lambda _id: broker)
    event_service = SimpleNamespace()
    run_service = _FakeRunService()
    service = CampaignService(
        broker_service,
        event_service,
        run_service=run_service,
        event_manager=_FakeEventManager(),
    )

    class DummyCampaign:
        id = "saved-campaign"
        run_id = "run-123"
        name = "Saved Campaign"

        def model_dump(self, **_kwargs):
            return {"id": "saved-campaign", "run_id": "run-123"}

    monkeypatch.setattr(service._compiler, "compile", lambda _payload: DummyCampaign())

    class FakeResponse:
        def __init__(self):
            self.request = httpx.Request("POST", "http://orchestrator")
            self.response = httpx.Response(status_code=500, request=self.request)

        def read(self):
            return b'{"status":"error"}'

        def raise_for_status(self):
            raise httpx.HTTPStatusError("boom", request=self.request, response=self.response)

        def json(self):
            return {"status": "error"}

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *_args, **_kwargs):
            if racing_terminal:
                run_service.active_run.status = CampaignRunStatus.ABORTED
            return FakeResponse()

    monkeypatch.setattr(
        campaign_transport_module.httpx,
        "AsyncClient",
        lambda: FakeAsyncClient(),
    )

    with pytest.raises(ServiceError):
        asyncio.run(service.start_campaign(1, {"campaign": "data"}, "user@example.com"))

    assert len(run_service.created_runs) == 1
    if racing_terminal:
        assert run_service.deleted_runs == []
    else:
        assert run_service.deleted_runs == [
            {
                "run_id": "run-123",
                "broker_id": 1,
                "user_email": "user@example.com",
            }
        ]


@pytest.mark.parametrize("error_type", [httpx.ConnectError, httpx.RequestError])
@pytest.mark.parametrize("racing_terminal", [False, True])
def test_start_campaign_request_error(monkeypatch, error_type, racing_terminal):
    broker = _make_broker("http://orchestrator", "secret-key")
    run_service = _FakeRunService()
    service = CampaignService(
        SimpleNamespace(get_broker=lambda _id: broker),
        SimpleNamespace(),
        run_service=run_service,
        event_manager=_FakeEventManager(),
    )

    class DummyCampaign:
        id = "saved-campaign"
        run_id = "run-123"
        name = "Saved Campaign"

        def model_dump(self, **_kwargs):
            return {"id": self.id, "run_id": self.run_id}

    monkeypatch.setattr(service._compiler, "compile", lambda _payload: DummyCampaign())

    request_error = error_type(
        "orchestrator unavailable",
        request=httpx.Request("POST", "http://orchestrator"),
    )

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *_args, **_kwargs):
            if racing_terminal:
                run_service.active_run.status = CampaignRunStatus.ABORTED
            raise request_error

    monkeypatch.setattr(
        campaign_transport_module.httpx,
        "AsyncClient",
        lambda: FakeAsyncClient(),
    )

    with pytest.raises(
        ServiceError,
        match="Unable to start the campaign with the orchestrator",
    ) as exc_info:
        asyncio.run(service.start_campaign(1, {"campaign": "data"}, "user@example.com"))

    assert exc_info.value.__cause__ is request_error
    assert len(run_service.created_runs) == 1
    if racing_terminal:
        assert run_service.deleted_runs == []
    else:
        assert run_service.deleted_runs == [
            {
                "run_id": "run-123",
                "broker_id": 1,
                "user_email": "user@example.com",
            }
        ]


def test_stop_campaign_success(monkeypatch):
    broker = _make_broker("http://orchestrator", "secret-key")
    broker_service = SimpleNamespace(get_broker=lambda _id: broker)
    event_service = SimpleNamespace()
    run_service = _FakeRunService()
    service = CampaignService(broker_service, event_service, run_service=run_service)

    capture = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"status": "stopped"}

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, headers=None, json=None):
            capture["url"] = url
            capture["headers"] = headers
            capture["json"] = json
            return FakeResponse()

    monkeypatch.setattr(
        campaign_transport_module.httpx,
        "AsyncClient",
        lambda: FakeAsyncClient(),
    )

    result = asyncio.run(service.stop_campaign(1, "run-123", "user@example.com"))

    assert result == {"status": "stopped"}
    assert capture["url"].endswith("/v1/orchestrator/stop_campaign")
    assert capture["headers"]["Authorization"] == "secret-key"
    assert capture["json"] == "run-123"
    assert run_service.transitioned_runs == [
        {
            "run_id": "run-123",
            "status": CampaignRunStatus.ABORTED,
            "outcome": CampaignRunOutcome.CANCELED,
            "user_email": "user@example.com",
            "broker_id": 1,
        }
    ]


def test_stop_campaign_missing_url():
    broker_service = SimpleNamespace(get_broker=lambda _id: _make_broker(None, "key"))
    service = CampaignService(broker_service, SimpleNamespace())

    with pytest.raises(NotFoundError):
        asyncio.run(service.stop_campaign(1, "id", "user@example.com"))


def test_stop_campaign_missing_key():
    broker_service = SimpleNamespace(get_broker=lambda _id: _make_broker("http://url", None))
    service = CampaignService(broker_service, SimpleNamespace())

    with pytest.raises(NotFoundError):
        asyncio.run(service.stop_campaign(1, "id", "user@example.com"))


def test_stop_campaign_http_error(monkeypatch):
    broker = _make_broker("http://orchestrator", "secret-key")
    broker_service = SimpleNamespace(get_broker=lambda _id: broker)
    run_service = _FakeRunService()
    service = CampaignService(broker_service, SimpleNamespace(), run_service=run_service)

    class FakeResponse:
        def __init__(self):
            self.request = httpx.Request("POST", "http://orchestrator")
            self.response = httpx.Response(status_code=500, request=self.request)

        def raise_for_status(self):
            raise httpx.HTTPStatusError("boom", request=self.request, response=self.response)

        def json(self):
            return {"status": "error"}

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *_args, **_kwargs):
            return FakeResponse()

    monkeypatch.setattr(
        campaign_transport_module.httpx,
        "AsyncClient",
        lambda: FakeAsyncClient(),
    )

    with pytest.raises(ServiceError):
        asyncio.run(service.stop_campaign(1, "run-123", "user@example.com"))

    assert run_service.transitioned_runs == []


def test_stop_campaign_already_terminal_is_idempotent(monkeypatch):
    broker = _make_broker("http://orchestrator", "secret-key")
    broker_service = SimpleNamespace(get_broker=lambda _id: broker)
    run_service = _FakeRunService()
    run_service.active_run.status = CampaignRunStatus.COMPLETED
    service = CampaignService(broker_service, SimpleNamespace(), run_service=run_service)

    class UnexpectedAsyncClient:
        async def __aenter__(self):
            pytest.fail("orchestrator request should not be attempted")

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(
        campaign_transport_module.httpx,
        "AsyncClient",
        lambda: UnexpectedAsyncClient(),
    )

    result = asyncio.run(service.stop_campaign(1, "run-123", "user@example.com"))

    assert result == {
        "status": "already_terminal",
        "run_id": "run-123",
        "run_status": CampaignRunStatus.COMPLETED.value,
    }
    assert run_service.transitioned_runs == []


def test_stop_campaign_rejects_run_not_owned_by_user(monkeypatch):
    broker = _make_broker("http://orchestrator", "secret-key")
    broker_service = SimpleNamespace(get_broker=lambda _id: broker)
    run_service = _FakeRunService()
    service = CampaignService(
        broker_service,
        SimpleNamespace(),
        run_service=run_service,
    )

    class UnexpectedAsyncClient:
        async def __aenter__(self):
            pytest.fail("orchestrator request should not be attempted")

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(
        campaign_transport_module.httpx,
        "AsyncClient",
        lambda: UnexpectedAsyncClient(),
    )

    with pytest.raises(NotFoundError):
        asyncio.run(service.stop_campaign(1, "run-123", "other@example.com"))


def test_stop_campaign_rejects_run_for_other_broker(monkeypatch):
    broker = _make_broker("http://orchestrator", "secret-key")
    broker_service = SimpleNamespace(get_broker=lambda _id: broker)
    run_service = _FakeRunService()
    run_service.active_run.broker_id = 9
    service = CampaignService(
        broker_service,
        SimpleNamespace(),
        run_service=run_service,
    )

    class UnexpectedAsyncClient:
        async def __aenter__(self):
            pytest.fail("orchestrator request should not be attempted")

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(
        campaign_transport_module.httpx,
        "AsyncClient",
        lambda: UnexpectedAsyncClient(),
    )

    with pytest.raises(NotFoundError):
        asyncio.run(service.stop_campaign(1, "run-123", "user@example.com"))


def test_event_delegation():
    event_service = SimpleNamespace(
        create_event=lambda event: f"created:{event}",
        get_event=lambda event_id: f"event:{event_id}",
        list_events=lambda campaign_id, step_id=None, run_id=None: [campaign_id],
    )
    broker_service = SimpleNamespace(get_broker=lambda _id: _make_broker("url", "key"))
    service = CampaignService(broker_service, event_service)

    assert service.create_event("payload") == "created:payload"
    assert service.get_event(3) == "event:3"
    assert service.list_events("campaign") == ["campaign"]


def test_relay_campaign_events_delegates_to_application_manager():
    event_manager = _FakeEventManager()
    websocket = object()
    service = CampaignService(
        SimpleNamespace(),
        SimpleNamespace(),
        event_manager=event_manager,
    )

    asyncio.run(service.relay_campaign_events(7, websocket))

    assert event_manager.relay_calls == [(7, websocket)]


def test_get_run_recovery_reads_owned_run_before_exact_ordered_events():
    calls = []
    run = SimpleNamespace(run_id="run-1", status=CampaignRunStatus.COMPLETED)
    run_service = SimpleNamespace(
        get_run_by_run_id=lambda user_email, run_id: (
            calls.append(("run", user_email, run_id)) or run
        )
    )
    event_service = SimpleNamespace(
        list_events_for_run=lambda run_id: (calls.append(("events", run_id)) or ["first", "second"])
    )
    service = CampaignService(
        SimpleNamespace(),
        event_service,
        run_service=run_service,
    )

    recovery = service.get_run_recovery("owner@example.com", "run-1")

    assert recovery == {"run": run, "events": ["first", "second"]}
    assert calls == [
        ("run", "owner@example.com", "run-1"),
        ("events", "run-1"),
    ]


def test_list_run_step_events_checks_owner_before_querying_exact_step():
    calls = []
    run_service = SimpleNamespace(
        get_run_by_run_id=lambda user_email, run_id: calls.append(("run", user_email, run_id))
    )
    event_service = SimpleNamespace(
        list_events_for_run_step=lambda run_id, step_id, before_id, after_id, limit: (
            calls.append(("events", run_id, step_id, before_id, after_id, limit))
            or ["first", "second"]
        )
    )
    service = CampaignService(
        SimpleNamespace(),
        event_service,
        run_service=run_service,
    )

    events = service.list_run_step_events(
        "owner@example.com",
        "run-1",
        "step-1",
        before_id=20,
        limit=25,
    )

    assert events == ["first", "second"]
    assert calls == [
        ("run", "owner@example.com", "run-1"),
        ("events", "run-1", "step-1", 20, None, 25),
    ]
