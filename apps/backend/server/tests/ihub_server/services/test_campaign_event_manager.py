import asyncio
import json
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from sqlmodel import Session, create_engine, select

from ihub_server.models.campaign_run import (
    CampaignRun,
    CampaignRunCreate,
    CampaignRunOutcome,
    CampaignRunStatus,
)
from ihub_server.models.orchestrator_event import OrchestratorEvent
from ihub_server.repositories import campaign_runs
from ihub_server.services import campaign_compilation as campaign_compilation_module
from ihub_server.services import campaign_events as event_module
from ihub_server.services import campaign_transport as campaign_transport_module
from ihub_server.services.campaign import CampaignService
from ihub_server.services.campaign_events import CampaignEventManager
from ihub_server.services.campaign_runs import CampaignRunService


class _BlockingUpstream:
    def __init__(self):
        self.messages = asyncio.Queue()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def recv(self):
        message = await self.messages.get()
        if isinstance(message, Exception):
            raise message
        return message


class _FakeBrowserWebSocket:
    def __init__(self):
        self.sent = []

    async def send_text(self, message):
        self.sent.append(message)

    async def receive(self):
        return {"type": "websocket.disconnect"}


def _database():
    engine = create_engine("sqlite://")
    CampaignRun.__table__.create(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql(
            """
            CREATE TABLE orchestratorevent (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaign_id VARCHAR NOT NULL,
                run_id VARCHAR,
                step_id VARCHAR,
                created_at DATETIME NOT NULL,
                event_type VARCHAR,
                fields_to_populate JSON,
                exception_message VARCHAR,
                payload JSON
            )
            """
        )

    def create_session():
        return Session(engine)

    return create_session


@pytest.fixture(autouse=True)
def fake_broker_service(monkeypatch):
    class FakeBrokerService:
        def __init__(self, _session):
            pass

        def get_broker(self, broker_id):
            assert broker_id == 1
            return SimpleNamespace(
                orchestrator_url="http://orchestrator",
                orchestrator_api_key="secret",
            )

    monkeypatch.setattr(event_module, "BrokerService", FakeBrokerService)


def _create_run(
    session_factory,
    *,
    run_id="run-1",
    campaign_id="campaign-1",
    status=CampaignRunStatus.ACTIVE,
):
    with session_factory() as session:
        return campaign_runs.create_run(
            session,
            CampaignRunCreate(
                user_email="user@example.com",
                campaign_id=campaign_id,
                run_id=run_id,
                run_at=datetime(2026, 7, 10, tzinfo=UTC),
                orchestrator_url="http://orchestrator",
                status=status,
                campaign_name="Campaign",
                broker_id=1,
            ),
        )


async def _wait_until(predicate):
    for _ in range(100):
        if predicate():
            return
        await asyncio.sleep(0)
    raise AssertionError("condition was not reached")


@pytest.mark.parametrize(
    "event_type",
    ["CAMPAIGN_COMPLETE", "CAMPAIGN_END", "CAMPAIGN_SUCCESS"],
)
def test_successful_terminal_events_complete_run_and_update_history(event_type):
    session_factory = _database()
    _create_run(session_factory)
    manager = CampaignEventManager(session_factory)

    manager._ingest_orchestrator_event(
        1,
        {
            "run_id": "run-1",
            "event": {"event_type": event_type},
        },
    )

    with session_factory() as session:
        run_service = CampaignRunService(session)
        run = run_service.get_run_by_run_id("user@example.com", "run-1")
        active_runs = run_service.list_runs(
            "user@example.com",
            "campaign-1",
            [CampaignRunStatus.ACTIVE],
            0,
            100,
        )
        completed_runs = run_service.list_runs(
            "user@example.com",
            "campaign-1",
            [CampaignRunStatus.COMPLETED],
            0,
            100,
        )
        events = session.exec(
            select(OrchestratorEvent).where(OrchestratorEvent.run_id == "run-1")
        ).all()

    assert run.status == CampaignRunStatus.COMPLETED
    assert run.outcome == CampaignRunOutcome.SUCCEEDED
    assert run.ended_at is not None
    assert active_runs == []
    assert [completed_run.run_id for completed_run in completed_runs] == ["run-1"]
    assert len(events) == 1
    assert events[0].campaign_id == "campaign-1"
    assert events[0].run_id == "run-1"
    assert events[0].event_type == event_type
    assert events[0].payload["campaign_id"] == "campaign-1"


def test_terminal_run_id_without_campaign_id_is_enriched_and_persisted():
    session_factory = _database()
    _create_run(session_factory)
    manager = CampaignEventManager(session_factory)

    manager._ingest_orchestrator_event(
        1,
        {
            "run_id": "run-1",
            "event": {"event_type": "UNKNOWN_ERROR"},
        },
    )

    with session_factory() as session:
        run = session.exec(select(CampaignRun).where(CampaignRun.run_id == "run-1")).one()
        assert run.status == CampaignRunStatus.ABORTED
        assert run.outcome == CampaignRunOutcome.FAILED
        first_ended_at = run.ended_at

    manager._ingest_orchestrator_event(
        1,
        {
            "run_id": "run-1",
            "event": {"event_type": "CAMPAIGN_COMPLETE"},
        },
    )

    with session_factory() as session:
        run = session.exec(select(CampaignRun).where(CampaignRun.run_id == "run-1")).one()
        assert run.status == CampaignRunStatus.ABORTED
        assert run.outcome == CampaignRunOutcome.FAILED
        assert run.ended_at == first_ended_at
        events = session.exec(
            select(OrchestratorEvent).where(OrchestratorEvent.run_id == "run-1")
        ).all()
    assert len(events) == 2
    assert all(event.campaign_id == "campaign-1" for event in events)
    assert all(event.payload["campaign_id"] == "campaign-1" for event in events)


def test_events_are_persisted_only_for_the_correlated_run_campaign(monkeypatch):
    session_factory = _database()
    _create_run(session_factory)
    created_events = []

    class FakeEventService:
        def __init__(self, _session):
            pass

        def record_correlated_event(
            self,
            event,
            _run,
            _terminal_status,
            _terminal_outcome,
        ):
            created_events.append(event)
            return SimpleNamespace(id=1)

    monkeypatch.setattr(event_module, "OrchestratorEventService", FakeEventService)
    manager = CampaignEventManager(session_factory)

    manager._ingest_orchestrator_event(
        1,
        {
            "campaign_id": "other-campaign",
            "run_id": "run-1",
            "event": {"event_type": "STEP_START"},
        },
    )
    manager._ingest_orchestrator_event(
        1,
        {
            "campaign_id": "campaign-1",
            "run_id": "run-1",
            "event": {"event_type": "STEP_COMPLETE", "step_id": "step-1"},
        },
    )

    assert len(created_events) == 1
    assert created_events[0].campaign_id == "campaign-1"
    assert created_events[0].run_id == "run-1"
    assert created_events[0].event_type == "STEP_COMPLETE"


def test_terminal_event_insert_and_run_transition_are_atomic(monkeypatch):
    session_factory = _database()
    _create_run(session_factory)
    manager = CampaignEventManager(session_factory)
    original_factory = manager._session_factory

    def failing_session_factory():
        session = original_factory()

        def fail_commit():
            raise RuntimeError("commit failed")

        monkeypatch.setattr(session, "commit", fail_commit)
        return session

    manager._session_factory = failing_session_factory

    with pytest.raises(RuntimeError, match="commit failed"):
        manager._ingest_orchestrator_event(
            1,
            {
                "run_id": "run-1",
                "event": {"event_type": "CAMPAIGN_COMPLETE"},
            },
        )

    with session_factory() as session:
        run = session.exec(select(CampaignRun).where(CampaignRun.run_id == "run-1")).one()
        events = session.exec(select(OrchestratorEvent)).all()
    assert run.status == CampaignRunStatus.ACTIVE
    assert events == []


def test_campaign_id_fallback_requires_exactly_one_active_run(monkeypatch):
    session_factory = _database()
    _create_run(session_factory)
    manager = CampaignEventManager(session_factory)

    manager._ingest_orchestrator_event(
        1,
        {
            "campaign_id": "campaign-1",
            "event": {"event_type": "CAMPAIGN_COMPLETE"},
        },
    )

    with session_factory() as session:
        first = session.exec(select(CampaignRun).where(CampaignRun.run_id == "run-1")).one()
        assert first.status == CampaignRunStatus.COMPLETED

    _create_run(session_factory, run_id="run-2", campaign_id="campaign-2")
    _create_run(session_factory, run_id="run-3", campaign_id="campaign-2")
    manager._ingest_orchestrator_event(
        1,
        {
            "campaign_id": "campaign-2",
            "event": {"event_type": "UNKNOWN_ERROR"},
        },
    )

    with session_factory() as session:
        ambiguous_runs = session.exec(
            select(CampaignRun).where(CampaignRun.campaign_id == "campaign-2")
        ).all()
        assert {run.status for run in ambiguous_runs} == {CampaignRunStatus.ACTIVE}


def test_start_row_exists_before_immediate_terminal_event(monkeypatch):
    async def scenario():
        session_factory = _database()
        upstream = _BlockingUpstream()
        monkeypatch.setattr(event_module.websockets, "connect", lambda *_args, **_kwargs: upstream)
        manager = CampaignEventManager(session_factory)

        class DummyCampaign:
            id = "campaign-1"
            run_id = "run-1"
            name = "Campaign"

            def model_dump(self, **_kwargs):
                return {"id": self.id, "run_id": self.run_id}

        monkeypatch.setattr(
            campaign_compilation_module.CampaignCompiler,
            "compile",
            lambda _compiler, _payload: DummyCampaign(),
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

            async def __aexit__(self, exc_type, exc, traceback):
                return False

            async def post(self, *_args, **_kwargs):
                with session_factory() as assertion_session:
                    run = assertion_session.exec(
                        select(CampaignRun).where(CampaignRun.run_id == "run-1")
                    ).one()
                    assert run.status == CampaignRunStatus.ACTIVE
                await upstream.messages.put(
                    json.dumps(
                        {
                            "campaign_id": "campaign-1",
                            "run_id": "run-1",
                            "event": {"event_type": "CAMPAIGN_COMPLETE"},
                        }
                    )
                )

                def run_completed():
                    with session_factory() as assertion_session:
                        run = assertion_session.exec(
                            select(CampaignRun).where(CampaignRun.run_id == "run-1")
                        ).one()
                        return run.status == CampaignRunStatus.COMPLETED

                await _wait_until(run_completed)
                return FakeResponse()

        monkeypatch.setattr(
            campaign_transport_module.httpx,
            "AsyncClient",
            lambda: FakeAsyncClient(),
        )
        broker = SimpleNamespace(
            orchestrator_url="http://orchestrator",
            orchestrator_api_key="secret",
        )
        with session_factory() as request_session:
            service = CampaignService(
                SimpleNamespace(get_broker=lambda _broker_id: broker),
                SimpleNamespace(),
                run_service=CampaignRunService(request_session),
                event_manager=manager,
            )
            result = await service.start_campaign(1, {"campaign": "data"}, "user@example.com")

        assert result == {
            "status": "ok",
            "campaign_id": "campaign-1",
            "run_id": "run-1",
        }
        with session_factory() as assertion_session:
            run = assertion_session.exec(
                select(CampaignRun).where(CampaignRun.run_id == "run-1")
            ).one()
            assert run.status == CampaignRunStatus.COMPLETED
        await manager.shutdown()

    asyncio.run(scenario())


def test_shared_listener_forwards_unpersisted_payload_to_all_subscribers(monkeypatch):
    async def scenario():
        session_factory = _database()
        _create_run(session_factory)
        upstream = _BlockingUpstream()
        connection_count = 0
        created_events = []

        def connect(*_args, **_kwargs):
            nonlocal connection_count
            connection_count += 1
            return upstream

        class FakeEventService:
            def __init__(self, _session):
                pass

            def record_correlated_event(
                self,
                event,
                _run,
                _terminal_status,
                _terminal_outcome,
            ):
                created_events.append(event)

        monkeypatch.setattr(event_module.websockets, "connect", connect)
        monkeypatch.setattr(event_module, "OrchestratorEventService", FakeEventService)
        manager = CampaignEventManager(session_factory)
        raw_message = json.dumps(
            {
                "campaign_id": "other-campaign",
                "run_id": "run-1",
                "event": {"event_type": "STEP_START"},
            }
        )

        async with manager.subscribe(1) as first_queue, manager.subscribe(1) as second_queue:
            await upstream.messages.put(raw_message)
            assert await first_queue.get() == raw_message
            assert await second_queue.get() == raw_message
            assert connection_count == 1

        assert created_events == []
        assert manager.has_listener(1)
        await manager.shutdown()

    asyncio.run(scenario())


def test_shared_listener_fans_out_enriched_correlated_payload(monkeypatch):
    async def scenario():
        session_factory = _database()
        _create_run(session_factory)
        upstream = _BlockingUpstream()
        monkeypatch.setattr(event_module.websockets, "connect", lambda *_a, **_k: upstream)
        manager = CampaignEventManager(session_factory)

        async with manager.subscribe(1) as queue:
            await upstream.messages.put(
                json.dumps(
                    {
                        "ihub_event_id": 999,
                        "event": {"event_type": "STEP_START", "step_id": "step-1"},
                    }
                )
            )
            relayed = json.loads(await queue.get())

        assert relayed["campaign_id"] == "campaign-1"
        assert relayed["run_id"] == "run-1"
        with session_factory() as session:
            event = session.exec(select(OrchestratorEvent)).one()
        assert relayed["ihub_event_id"] == event.id
        assert event.run_id == "run-1"
        assert event.payload == {
            "campaign_id": "campaign-1",
            "run_id": "run-1",
            "event": {"event_type": "STEP_START", "step_id": "step-1"},
        }
        assert "ihub_event_id" not in event.payload
        await manager.shutdown()

    asyncio.run(scenario())


def test_ingestion_failure_forwards_frame_and_continues_listener(monkeypatch):
    async def scenario():
        session_factory = _database()
        _create_run(session_factory)
        upstream = _BlockingUpstream()
        monkeypatch.setattr(event_module.websockets, "connect", lambda *_args, **_kwargs: upstream)
        manager = CampaignEventManager(session_factory)
        original_ingest = manager._ingest_orchestrator_event
        ingestion_attempts = 0

        def ingest_with_one_failure(broker_id, payload):
            nonlocal ingestion_attempts
            ingestion_attempts += 1
            if ingestion_attempts == 1:
                raise RuntimeError("database unavailable")
            original_ingest(broker_id, payload)

        monkeypatch.setattr(manager, "_ingest_orchestrator_event", ingest_with_one_failure)
        failed_frame = json.dumps(
            {
                "campaign_id": "campaign-1",
                "run_id": "run-1",
                "event": {"event_type": "STEP_START"},
            }
        )
        terminal_frame = json.dumps(
            {
                "campaign_id": "campaign-1",
                "run_id": "run-1",
                "event": {"event_type": "CAMPAIGN_COMPLETE"},
            }
        )

        async with manager.subscribe(1) as queue:
            await upstream.messages.put(failed_frame)
            assert await queue.get() == failed_frame
            assert manager.has_listener(1)

            await upstream.messages.put(terminal_frame)
            assert await queue.get() == terminal_frame
            with session_factory() as session:
                run = session.exec(select(CampaignRun).where(CampaignRun.run_id == "run-1")).one()
                assert run.status == CampaignRunStatus.COMPLETED

        assert ingestion_attempts == 2
        await manager.shutdown()

    asyncio.run(scenario())


def test_browser_disconnect_removes_only_subscriber_while_run_is_active(monkeypatch):
    async def scenario():
        session_factory = _database()
        _create_run(session_factory)
        upstream = _BlockingUpstream()
        monkeypatch.setattr(event_module.websockets, "connect", lambda *_args, **_kwargs: upstream)
        manager = CampaignEventManager(session_factory)
        websocket = _FakeBrowserWebSocket()

        await manager.relay_events(1, websocket)

        assert json.loads(websocket.sent[0]) == {"message_type": "relay_ready", "broker_id": 1}
        assert manager.subscriber_count(1) == 0
        assert manager.has_listener(1)

        await upstream.messages.put(
            json.dumps(
                {
                    "run_id": "run-1",
                    "event": {"event_type": "CAMPAIGN_COMPLETE"},
                }
            )
        )
        await _wait_until(lambda: not manager.has_listener(1))

    asyncio.run(scenario())


def test_startup_recovers_active_brokers_and_shutdown_cancels_listeners(monkeypatch):
    async def scenario():
        session_factory = _database()
        _create_run(session_factory)
        upstream = _BlockingUpstream()
        connection_count = 0

        def connect(*_args, **_kwargs):
            nonlocal connection_count
            connection_count += 1
            return upstream

        monkeypatch.setattr(event_module.websockets, "connect", connect)
        manager = CampaignEventManager(session_factory)

        await manager.start()
        await _wait_until(lambda: connection_count == 1)
        assert manager.has_listener(1)

        await manager.shutdown()
        assert not manager.has_listener(1)

    asyncio.run(scenario())


def test_dropped_upstream_retries_with_bounded_delay_while_run_is_active(monkeypatch):
    async def scenario():
        session_factory = _database()
        _create_run(session_factory)
        first = _BlockingUpstream()
        second = _BlockingUpstream()
        connections = [first, second]
        connection_count = 0

        def connect(*_args, **_kwargs):
            nonlocal connection_count
            connection = connections[min(connection_count, len(connections) - 1)]
            connection_count += 1
            return connection

        monkeypatch.setattr(event_module.websockets, "connect", connect)
        manager = CampaignEventManager(session_factory, reconnect_delays=(0.0, 0.01))

        await manager.start()
        await _wait_until(lambda: connection_count == 1)
        await first.messages.put(OSError("dropped"))
        await _wait_until(lambda: connection_count >= 2)

        assert manager.has_listener(1)
        await manager.shutdown()

    asyncio.run(scenario())
