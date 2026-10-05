from datetime import UTC, datetime, timedelta

from sqlmodel import Session, create_engine

from ihub_server.models.campaign_run import (
    CampaignRun,
    CampaignRunCreate,
    CampaignRunOutcome,
    CampaignRunStatus,
)
from ihub_server.repositories import campaign_runs


def _session() -> Session:
    engine = create_engine("sqlite://")
    CampaignRun.__table__.create(engine)
    return Session(engine)


def _create_run(
    session: Session,
    *,
    user_email: str,
    campaign_id: str,
    run_id: str,
    run_at: datetime,
    status: CampaignRunStatus | None = CampaignRunStatus.ACTIVE,
    broker_id: int | None = 1,
    campaign_name: str | None = "",
) -> CampaignRun:
    resolved_campaign_name = f"Campaign {campaign_id}" if campaign_name == "" else campaign_name
    return campaign_runs.create_run(
        session,
        CampaignRunCreate(
            user_email=user_email,
            campaign_id=campaign_id,
            run_id=run_id,
            run_at=run_at,
            orchestrator_url="http://orchestrator",
            status=status,
            campaign_name=resolved_campaign_name,
            broker_id=broker_id,
        ),
    )


def test_create_run_commits_refreshes_and_returns_model():
    session = _session()
    run = _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-1",
        run_id="run-1",
        run_at=datetime(2026, 5, 21, tzinfo=UTC),
    )

    assert run.id == 1
    assert run.user_email == "user@example.com"


def test_create_run_round_trips_campaign_snapshots():
    session = _session()
    created = campaign_runs.create_run(
        session,
        CampaignRunCreate(
            user_email="user@example.com",
            campaign_id="campaign-1",
            run_id="run-1",
            submitted_campaign_snapshot={"campaignId": "campaign-1", "nodes": []},
            orchestrator_campaign_snapshot={
                "id": "campaign-1",
                "run_id": "run-1",
                "task_groups": [],
            },
        ),
    )

    loaded = campaign_runs.get_run_by_run_id(session, "user@example.com", "run-1")

    assert loaded == created
    assert loaded.submitted_campaign_snapshot == {
        "campaignId": "campaign-1",
        "nodes": [],
    }
    assert loaded.orchestrator_campaign_snapshot == {
        "id": "campaign-1",
        "run_id": "run-1",
        "task_groups": [],
    }


def test_list_runs_filters_by_user_and_campaign():
    session = _session()
    now = datetime(2026, 5, 21, tzinfo=UTC)
    _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-1",
        run_id="run-1",
        run_at=now,
    )
    _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-2",
        run_id="run-2",
        run_at=now + timedelta(seconds=1),
    )
    _create_run(
        session,
        user_email="other@example.com",
        campaign_id="campaign-1",
        run_id="run-3",
        run_at=now + timedelta(seconds=2),
    )

    all_user_runs = campaign_runs.list_runs(
        session,
        "user@example.com",
        None,
        None,
        0,
        10,
    )
    campaign_1_runs = campaign_runs.list_runs(
        session,
        "user@example.com",
        "campaign-1",
        None,
        0,
        10,
    )
    second_page = campaign_runs.list_runs(
        session,
        "user@example.com",
        None,
        None,
        1,
        1,
    )
    blank_name_filter_runs = campaign_runs.list_runs(
        session,
        "user@example.com",
        None,
        None,
        0,
        10,
        "   ",
    )

    assert [run.run_id for run in all_user_runs] == ["run-2", "run-1"]
    assert [run.run_id for run in campaign_1_runs] == ["run-1"]
    assert [run.run_id for run in second_page] == ["run-1"]
    assert [run.run_id for run in blank_name_filter_runs] == ["run-2", "run-1"]


def test_get_run_by_run_id_filters_by_user():
    session = _session()
    run_at = datetime(2026, 5, 21, tzinfo=UTC)
    _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-1",
        run_id="run-1",
        run_at=run_at,
    )

    assert campaign_runs.get_run_by_run_id(session, "user@example.com", "run-1").run_id == "run-1"
    assert campaign_runs.get_run_by_run_id(session, "other@example.com", "run-1") is None


def test_get_run_by_run_id_and_broker_scopes_internal_correlation():
    session = _session()
    run = _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-1",
        run_id="run-1",
        run_at=datetime(2026, 5, 21, tzinfo=UTC),
    )

    assert campaign_runs.get_run_by_run_id_and_broker(session, run.run_id, 1) == run
    assert campaign_runs.get_run_by_run_id_and_broker(session, run.run_id, 2) is None


def test_list_runs_filters_statuses_and_excludes_legacy_rows():
    session = _session()
    now = datetime(2026, 5, 21, tzinfo=UTC)
    _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-1",
        run_id="active-run",
        run_at=now,
    )
    _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-2",
        run_id="completed-run",
        run_at=now + timedelta(seconds=1),
        status=CampaignRunStatus.COMPLETED,
    )
    _create_run(
        session,
        user_email="user@example.com",
        campaign_id="legacy-campaign",
        run_id="legacy-run",
        run_at=now + timedelta(seconds=2),
        status=None,
        broker_id=None,
    )

    terminal_runs = campaign_runs.list_runs(
        session,
        "user@example.com",
        None,
        [CampaignRunStatus.COMPLETED, CampaignRunStatus.ABORTED],
        0,
        10,
    )

    assert [run.run_id for run in terminal_runs] == ["completed-run"]


def test_list_runs_filters_campaign_name_case_insensitively_and_by_user():
    session = _session()
    now = datetime(2026, 5, 21, tzinfo=UTC)
    _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-1",
        run_id="matching-run",
        run_at=now,
        campaign_name="Neutron Scattering Sweep",
    )
    _create_run(
        session,
        user_email="other@example.com",
        campaign_id="campaign-2",
        run_id="other-user-run",
        run_at=now + timedelta(seconds=1),
        campaign_name="Neutron Calibration",
    )
    _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-3",
        run_id="null-name-run",
        run_at=now + timedelta(seconds=2),
        campaign_name=None,
    )

    matches = campaign_runs.list_runs(
        session,
        "user@example.com",
        None,
        None,
        0,
        10,
        "  SCATTERing  ",
    )

    assert [run.run_id for run in matches] == ["matching-run"]


def test_list_runs_combines_campaign_name_and_status_filters():
    session = _session()
    now = datetime(2026, 5, 21, tzinfo=UTC)
    _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-1",
        run_id="active-match",
        run_at=now,
        campaign_name="Beam Test",
    )
    _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-2",
        run_id="completed-match",
        run_at=now + timedelta(seconds=1),
        status=CampaignRunStatus.COMPLETED,
        campaign_name="Beam Test Complete",
    )
    _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-3",
        run_id="completed-nonmatch",
        run_at=now + timedelta(seconds=2),
        status=CampaignRunStatus.COMPLETED,
        campaign_name="Calibration",
    )

    matches = campaign_runs.list_runs(
        session,
        "user@example.com",
        None,
        [CampaignRunStatus.COMPLETED],
        0,
        10,
        "beam",
    )

    assert [run.run_id for run in matches] == ["completed-match"]


def test_list_runs_treats_sql_wildcards_as_literal_name_text():
    session = _session()
    now = datetime(2026, 5, 21, tzinfo=UTC)
    names = [
        ("literal-percent", "Load 100% Sample"),
        ("percent-wildcard-candidate", "Load 1000 Sample"),
        ("literal-underscore", "Sweep_A"),
        ("underscore-wildcard-candidate", "SweepXA"),
    ]
    for index, (run_id, campaign_name) in enumerate(names):
        _create_run(
            session,
            user_email="user@example.com",
            campaign_id=f"campaign-{index}",
            run_id=run_id,
            run_at=now + timedelta(seconds=index),
            campaign_name=campaign_name,
        )

    percent_matches = campaign_runs.list_runs(
        session,
        "user@example.com",
        None,
        None,
        0,
        10,
        "100%",
    )
    underscore_matches = campaign_runs.list_runs(
        session,
        "user@example.com",
        None,
        None,
        0,
        10,
        "Sweep_",
    )

    assert [run.run_id for run in percent_matches] == ["literal-percent"]
    assert [run.run_id for run in underscore_matches] == ["literal-underscore"]


def test_list_runs_applies_campaign_name_filter_before_offset_and_limit():
    session = _session()
    now = datetime(2026, 5, 21, tzinfo=UTC)
    _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-1",
        run_id="older-match",
        run_at=now,
        campaign_name="Matching Experiment One",
    )
    _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-2",
        run_id="newer-match",
        run_at=now + timedelta(seconds=1),
        campaign_name="Matching Experiment Two",
    )
    _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-3",
        run_id="newest-nonmatch",
        run_at=now + timedelta(seconds=2),
        campaign_name="Calibration",
    )

    second_match = campaign_runs.list_runs(
        session,
        "user@example.com",
        None,
        None,
        1,
        1,
        "matching",
    )

    assert [run.run_id for run in second_match] == ["older-match"]


def test_list_runs_searches_name_or_partial_run_id_case_insensitively_by_user():
    session = _session()
    now = datetime(2026, 5, 21, tzinfo=UTC)
    _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-1",
        run_id="run-name-match",
        run_at=now,
        campaign_name="Neutron Scattering Sweep",
    )
    _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-2",
        run_id="RUN-NeUtRoN-12345",
        run_at=now + timedelta(seconds=1),
        campaign_name="Calibration",
    )
    _create_run(
        session,
        user_email="other@example.com",
        campaign_id="campaign-3",
        run_id="run-neutron-other-user",
        run_at=now + timedelta(seconds=2),
        campaign_name="Neutron Other User",
    )

    matches = campaign_runs.list_runs(
        session,
        "user@example.com",
        None,
        None,
        0,
        10,
        search="  NEUTRON  ",
    )

    assert [run.run_id for run in matches] == ["RUN-NeUtRoN-12345", "run-name-match"]


def test_list_runs_search_treats_sql_wildcards_as_literal_text():
    session = _session()
    now = datetime(2026, 5, 21, tzinfo=UTC)
    runs = [
        ("literal-percent", "Load 100% Sample"),
        ("percent-wildcard-candidate", "Load 1000 Sample"),
        ("run_literal_underscore", "Calibration"),
        ("runXliteralXunderscore", "Calibration"),
    ]
    for index, (run_id, campaign_name) in enumerate(runs):
        _create_run(
            session,
            user_email="user@example.com",
            campaign_id=f"campaign-{index}",
            run_id=run_id,
            run_at=now + timedelta(seconds=index),
            campaign_name=campaign_name,
        )

    percent_matches = campaign_runs.list_runs(
        session,
        "user@example.com",
        None,
        None,
        0,
        10,
        search="100%",
    )
    underscore_matches = campaign_runs.list_runs(
        session,
        "user@example.com",
        None,
        None,
        0,
        10,
        search="literal_underscore",
    )

    assert [run.run_id for run in percent_matches] == ["literal-percent"]
    assert [run.run_id for run in underscore_matches] == ["run_literal_underscore"]


def test_list_runs_composes_search_with_name_status_and_pagination_filters():
    session = _session()
    now = datetime(2026, 5, 21, tzinfo=UTC)
    runs = [
        ("match-older", "Beam Test", CampaignRunStatus.COMPLETED),
        ("match-newer", "Beam Test", CampaignRunStatus.COMPLETED),
        ("match-active", "Beam Test", CampaignRunStatus.ACTIVE),
        ("match-other-name", "Calibration", CampaignRunStatus.COMPLETED),
    ]
    for index, (run_id, campaign_name, status) in enumerate(runs):
        _create_run(
            session,
            user_email="user@example.com",
            campaign_id=f"campaign-{index}",
            run_id=run_id,
            run_at=now + timedelta(seconds=index),
            status=status,
            campaign_name=campaign_name,
        )

    second_match = campaign_runs.list_runs(
        session,
        "user@example.com",
        None,
        [CampaignRunStatus.COMPLETED],
        1,
        1,
        campaign_name="beam",
        search="match",
    )

    assert [run.run_id for run in second_match] == ["match-older"]


def test_transition_active_run_is_idempotent_and_preserves_first_terminal_state():
    session = _session()
    run = _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-1",
        run_id="run-1",
        run_at=datetime(2026, 5, 21, tzinfo=UTC),
    )

    completed = campaign_runs.transition_active_run(
        session,
        run.run_id,
        CampaignRunStatus.COMPLETED,
        outcome=CampaignRunOutcome.SUCCEEDED,
        user_email="user@example.com",
        broker_id=1,
    )
    first_ended_at = completed.ended_at
    repeated = campaign_runs.transition_active_run(
        session,
        run.run_id,
        CampaignRunStatus.ABORTED,
        outcome=CampaignRunOutcome.FAILED,
        user_email="user@example.com",
        broker_id=1,
    )

    assert completed.status == CampaignRunStatus.COMPLETED
    assert completed.outcome == CampaignRunOutcome.SUCCEEDED
    assert first_ended_at is not None
    assert repeated.status == CampaignRunStatus.COMPLETED
    assert repeated.outcome == CampaignRunOutcome.SUCCEEDED
    assert repeated.ended_at == first_ended_at
    assert (
        campaign_runs.transition_active_run(
            session,
            run.run_id,
            CampaignRunStatus.ABORTED,
            outcome=CampaignRunOutcome.FAILED,
            user_email="other@example.com",
        )
        is None
    )


def test_list_active_runs_by_campaign_and_broker_returns_at_most_requested_candidates():
    session = _session()
    now = datetime(2026, 5, 21, tzinfo=UTC)
    for index in range(3):
        _create_run(
            session,
            user_email="user@example.com",
            campaign_id="campaign-1",
            run_id=f"run-{index}",
            run_at=now + timedelta(seconds=index),
        )

    candidates = campaign_runs.list_active_runs_by_campaign_and_broker(
        session,
        "campaign-1",
        1,
        limit=2,
    )

    assert [run.run_id for run in candidates] == ["run-2", "run-1"]


def test_active_broker_queries_and_conditional_prestart_delete():
    session = _session()
    active = _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-1",
        run_id="active-run",
        run_at=datetime(2026, 5, 21, tzinfo=UTC),
        broker_id=1,
    )
    _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-2",
        run_id="completed-run",
        run_at=datetime(2026, 5, 21, tzinfo=UTC),
        status=CampaignRunStatus.COMPLETED,
        broker_id=2,
    )

    assert campaign_runs.list_active_broker_ids(session) == [1]
    assert campaign_runs.has_active_runs_for_broker(session, 1)
    assert not campaign_runs.has_active_runs_for_broker(session, 2)
    assert not campaign_runs.delete_active_run(
        session,
        active.run_id,
        1,
        user_email="other@example.com",
    )
    assert campaign_runs.delete_active_run(
        session,
        active.run_id,
        1,
        user_email="user@example.com",
    )
    assert campaign_runs.get_run_by_run_id(session, "user@example.com", active.run_id) is None


def test_broker_disappearance_interrupts_only_active_runs():
    session = _session()
    active = _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-1",
        run_id="active-run",
        run_at=datetime(2026, 5, 21, tzinfo=UTC),
        broker_id=1,
    )
    completed = _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-1",
        run_id="completed-run",
        run_at=datetime(2026, 5, 21, tzinfo=UTC),
        status=CampaignRunStatus.COMPLETED,
        broker_id=1,
    )

    campaign_runs.abort_active_runs_for_broker(session, 1)

    assert active.status == CampaignRunStatus.ABORTED
    assert active.outcome == CampaignRunOutcome.INTERRUPTED
    assert completed.status == CampaignRunStatus.COMPLETED
    assert completed.outcome is None


def test_delete_active_run_preserves_racing_terminal_transition():
    session = _session()
    run = _create_run(
        session,
        user_email="user@example.com",
        campaign_id="campaign-1",
        run_id="run-1",
        run_at=datetime(2026, 5, 21, tzinfo=UTC),
        broker_id=1,
    )
    campaign_runs.transition_active_run(
        session,
        run.run_id,
        CampaignRunStatus.ABORTED,
        broker_id=1,
    )

    assert not campaign_runs.delete_active_run(session, run.run_id, 1)
    preserved = campaign_runs.get_run_by_run_id(session, "user@example.com", run.run_id)
    assert preserved.status == CampaignRunStatus.ABORTED
