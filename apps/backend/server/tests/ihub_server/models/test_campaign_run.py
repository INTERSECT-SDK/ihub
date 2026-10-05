from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from ihub_server.models.campaign_run import (
    CampaignRun,
    CampaignRunCreate,
    CampaignRunOutcome,
    CampaignRunPublic,
    CampaignRunStatus,
)


def test_campaign_run_defaults_and_serialization():
    run = CampaignRun(
        campaign_id="campaign-1",
        run_id="run-1",
        submitted_campaign_snapshot={"campaignId": "campaign-1"},
        orchestrator_campaign_snapshot={"id": "campaign-1", "run_id": "run-1"},
    )

    assert run.run_at.tzinfo == UTC
    assert run.model_dump()["user_email"] is None
    assert run.orchestrator_url is None
    assert run.status == CampaignRunStatus.ACTIVE
    assert run.ended_at is None
    assert run.outcome is None
    assert run.campaign_name is None
    assert run.broker_id is None

    run.id = 7
    public = CampaignRunPublic.from_run(run)
    assert public.id == 7
    assert public.campaign_id == "campaign-1"
    assert public.status == CampaignRunStatus.ACTIVE
    assert public.outcome is None
    assert public.snapshot_available
    assert "submitted_campaign_snapshot" not in public.model_dump()
    assert "orchestrator_campaign_snapshot" not in public.model_dump()


def test_campaign_run_public_serializes_terminal_outcome():
    run = CampaignRun(
        id=7,
        campaign_id="campaign-1",
        run_id="run-1",
        status=CampaignRunStatus.ABORTED,
        outcome=CampaignRunOutcome.FAILED,
    )

    assert CampaignRunPublic.from_run(run).outcome == CampaignRunOutcome.FAILED


def test_campaign_run_create_requires_fields():
    with pytest.raises(ValidationError):
        CampaignRunCreate(user_email="user@example.com", campaign_id="campaign-1")


def test_campaign_run_accepts_explicit_run_at():
    run_at = datetime(2026, 5, 21, tzinfo=UTC)
    run = CampaignRunCreate(
        user_email="user@example.com",
        campaign_id="campaign-1",
        run_id="run-1",
        run_at=run_at,
        orchestrator_url="http://orchestrator",
    )

    assert run.run_at == run_at


def test_campaign_run_public_accepts_unclassified_legacy_rows():
    run = CampaignRun(
        campaign_id="legacy-campaign",
        run_id="legacy-run",
        status=None,
    )

    run.id = 8
    public = CampaignRunPublic.from_run(run)

    assert public.status is None
    assert public.ended_at is None
    assert public.campaign_name is None
    assert public.broker_id is None
