from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlmodel import Session, create_engine

from ihub_server.models.campaign_run import (
    CampaignRun,
    CampaignRunOutcome,
    CampaignRunStatus,
)
from ihub_server.models.orchestrator_event import OrchestratorEvent, OrchestratorEventCreate
from ihub_server.repositories import orchestrator_events


class _FakeSession:
    def __init__(self):
        self.added = []
        self.commits = 0
        self.refreshed = []

    def add(self, event):
        self.added.append(event)

    def commit(self):
        self.commits += 1

    def refresh(self, event):
        self.refreshed.append(event)


def test_create_event_always_inserts_new_event_for_same_campaign():
    session = _FakeSession()

    first = orchestrator_events.create_event(
        session,
        OrchestratorEventCreate(
            campaign_id="campaign-1",
            step_id="step-1",
            event_type="STEP_START",
        ),
    )
    second = orchestrator_events.create_event(
        session,
        OrchestratorEventCreate(
            campaign_id="campaign-1",
            step_id="step-1",
            event_type="STEP_COMPLETE",
        ),
    )

    assert session.added == [first, second]
    assert first is not second
    assert first.event_type == "STEP_START"
    assert second.event_type == "STEP_COMPLETE"
    assert session.commits == 2
    assert session.refreshed == [first, second]


def test_create_event_populates_run_id_from_payload_when_missing():
    session = _FakeSession()

    created = orchestrator_events.create_event(
        session,
        OrchestratorEventCreate(
            campaign_id="campaign-1",
            step_id="step-1",
            payload={"run_id": "run-123"},
        ),
    )

    assert created.run_id == "run-123"


def test_list_events_for_run_orders_equal_timestamps_by_id():
    engine = create_engine("sqlite://")
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
    timestamp = datetime(2026, 8, 11, tzinfo=UTC)
    with Session(engine) as session:
        for event in [
            OrchestratorEventCreate(
                campaign_id="campaign-1",
                run_id="run-1",
                event_type="SECOND",
                created_at=timestamp + timedelta(seconds=1),
            ),
            OrchestratorEventCreate(
                campaign_id="campaign-1",
                run_id="run-1",
                event_type="FIRST-A",
                created_at=timestamp,
            ),
            OrchestratorEventCreate(
                campaign_id="campaign-1",
                run_id="run-1",
                event_type="FIRST-B",
                created_at=timestamp,
            ),
            OrchestratorEventCreate(
                campaign_id="campaign-1",
                run_id="other-run",
                event_type="UNRELATED",
                created_at=timestamp,
            ),
        ]:
            orchestrator_events.create_event(session, event)

        events = orchestrator_events.list_events_for_run(session, "run-1")

    assert [event.event_type for event in events] == [
        "FIRST-A",
        "FIRST-B",
        "SECOND",
    ]


def test_list_events_for_run_step_filters_exactly_and_pages_by_persisted_id():
    engine = create_engine("sqlite://")
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
    timestamp = datetime(2026, 8, 17, tzinfo=UTC)
    with Session(engine) as session:
        for event in [
            OrchestratorEventCreate(
                campaign_id="campaign-1",
                run_id="run-1",
                step_id="step-1",
                event_type="SECOND",
                created_at=timestamp + timedelta(seconds=1),
            ),
            OrchestratorEventCreate(
                campaign_id="campaign-1",
                run_id="run-1",
                step_id="step-1",
                event_type="FIRST-A",
                created_at=timestamp,
            ),
            OrchestratorEventCreate(
                campaign_id="campaign-1",
                run_id="run-1",
                step_id="step-1",
                event_type="FIRST-B",
                created_at=timestamp,
            ),
            OrchestratorEventCreate(
                campaign_id="campaign-1",
                run_id="run-1",
                step_id="other-step",
                event_type="OTHER-STEP",
                created_at=timestamp,
            ),
            OrchestratorEventCreate(
                campaign_id="campaign-1",
                run_id="other-run",
                step_id="step-1",
                event_type="OTHER-RUN",
                created_at=timestamp,
            ),
        ]:
            orchestrator_events.create_event(session, event)

        latest = orchestrator_events.list_events_for_run_step(
            session,
            "run-1",
            "step-1",
            limit=2,
        )
        older = orchestrator_events.list_events_for_run_step(
            session,
            "run-1",
            "step-1",
            before_id=latest[0].id,
            limit=2,
        )
        newer = orchestrator_events.list_events_for_run_step(
            session,
            "run-1",
            "step-1",
            after_id=older[-1].id,
            limit=1,
        )

    assert [event.event_type for event in latest] == ["FIRST-A", "FIRST-B"]
    assert [event.event_type for event in older] == ["SECOND"]
    assert [event.event_type for event in newer] == ["FIRST-A"]


def test_conflicting_terminal_events_preserve_first_run_transition(tmp_path: Path):
    engine = create_engine(f"sqlite:///{tmp_path / 'orchestrator-events.db'}")
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

    with Session(engine) as setup_session:
        setup_session.add(
            CampaignRun(
                user_email="owner@example.com",
                campaign_id="campaign-1",
                run_id="run-1",
                orchestrator_url="http://orchestrator",
                status=CampaignRunStatus.ACTIVE,
                broker_id=1,
            )
        )
        setup_session.commit()

    with Session(engine) as first_session, Session(engine) as stale_session:
        first_run = first_session.get(CampaignRun, 1)
        stale_run = stale_session.get(CampaignRun, 1)
        assert first_run is not None
        assert stale_run is not None
        assert stale_run.status == CampaignRunStatus.ACTIVE

        orchestrator_events.record_correlated_event(
            first_session,
            OrchestratorEventCreate(
                campaign_id="campaign-1",
                run_id="run-1",
                event_type="CAMPAIGN_COMPLETE",
            ),
            first_run,
            CampaignRunStatus.COMPLETED,
        )
        with Session(engine) as verification_session:
            completed_run = verification_session.get(CampaignRun, 1)
            assert completed_run is not None
            first_ended_at = completed_run.ended_at

        orchestrator_events.record_correlated_event(
            stale_session,
            OrchestratorEventCreate(
                campaign_id="campaign-1",
                run_id="run-1",
                event_type="UNKNOWN_ERROR",
            ),
            stale_run,
            CampaignRunStatus.ABORTED,
        )

    with Session(engine) as verification_session:
        persisted_run = verification_session.get(CampaignRun, 1)
        events = orchestrator_events.list_events_for_run(
            verification_session,
            "run-1",
        )

    assert persisted_run is not None
    assert persisted_run.status == CampaignRunStatus.COMPLETED
    assert persisted_run.outcome == CampaignRunOutcome.SUCCEEDED
    assert persisted_run.ended_at == first_ended_at
    assert [event.event_type for event in events] == [
        "CAMPAIGN_COMPLETE",
        "UNKNOWN_ERROR",
    ]
    engine.dispose()
