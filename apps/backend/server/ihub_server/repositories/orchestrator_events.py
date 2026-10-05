"""Repository helpers to create and query orchestrator events."""

from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy import update
from sqlmodel import Session, col, select

from ihub_server.models.campaign_run import (
    CampaignRun,
    CampaignRunOutcome,
    CampaignRunStatus,
)
from ihub_server.models.orchestrator_event import OrchestratorEvent, OrchestratorEventCreate


def create_event(session: Session, event: OrchestratorEventCreate) -> OrchestratorEvent:
    if event.run_id is None and isinstance(event.payload, dict):
        payload_run_id = event.payload.get("run_id")
        if isinstance(payload_run_id, str) and payload_run_id:
            event.run_id = payload_run_id

    db_event = OrchestratorEvent.model_validate(event)
    session.add(db_event)
    session.commit()
    session.refresh(db_event)
    return db_event


def record_correlated_event(
    session: Session,
    event: OrchestratorEventCreate,
    run: CampaignRun,
    terminal_status: CampaignRunStatus | None = None,
    terminal_outcome: CampaignRunOutcome | None = None,
) -> OrchestratorEvent:
    """Persist an event and its optional terminal run transition atomically."""
    db_event = OrchestratorEvent.model_validate(event)
    session.add(db_event)
    if terminal_status is not None:
        resolved_outcome = terminal_outcome or (
            CampaignRunOutcome.SUCCEEDED
            if terminal_status == CampaignRunStatus.COMPLETED
            else CampaignRunOutcome.FAILED
        )
        statement = (
            update(CampaignRun)
            .where(
                cast(Any, CampaignRun.run_id) == run.run_id,
                cast(Any, CampaignRun.status) == CampaignRunStatus.ACTIVE.value,
            )
            .values(
                status=terminal_status.value,
                outcome=resolved_outcome.value,
                ended_at=datetime.now(UTC),
            )
            .execution_options(synchronize_session=False)
        )
        session.exec(statement)
    session.commit()
    session.refresh(db_event)
    return db_event


def get_event(session: Session, event_id: int) -> OrchestratorEvent | None:
    return session.get(OrchestratorEvent, event_id)


def list_events(
    session: Session,
    campaign_id: str | None = None,
    step_id: str | None = None,
    run_id: str | None = None,
) -> list[OrchestratorEvent]:
    if campaign_id and step_id and run_id:
        statement = select(OrchestratorEvent).where(
            OrchestratorEvent.campaign_id == campaign_id,
            OrchestratorEvent.step_id == step_id,
            OrchestratorEvent.run_id == run_id,
        )
    elif campaign_id and step_id:
        statement = select(OrchestratorEvent).where(
            OrchestratorEvent.campaign_id == campaign_id, OrchestratorEvent.step_id == step_id
        )
    elif campaign_id and run_id:
        statement = select(OrchestratorEvent).where(
            OrchestratorEvent.campaign_id == campaign_id, OrchestratorEvent.run_id == run_id
        )
    elif step_id and run_id:
        statement = select(OrchestratorEvent).where(
            OrchestratorEvent.step_id == step_id, OrchestratorEvent.run_id == run_id
        )
    elif campaign_id:
        statement = select(OrchestratorEvent).where(OrchestratorEvent.campaign_id == campaign_id)
    elif step_id:
        statement = select(OrchestratorEvent).where(OrchestratorEvent.step_id == step_id)
    elif run_id:
        statement = select(OrchestratorEvent).where(OrchestratorEvent.run_id == run_id)
    else:
        statement = select(OrchestratorEvent)
    return cast(list[OrchestratorEvent], session.exec(statement).all())


def list_events_for_run(
    session: Session,
    run_id: str,
) -> list[OrchestratorEvent]:
    """Return one run's replay stream in deterministic persistence order."""
    statement = (
        select(OrchestratorEvent)
        .where(OrchestratorEvent.run_id == run_id)
        .order_by(col(OrchestratorEvent.created_at), col(OrchestratorEvent.id))
    )
    return cast(list[OrchestratorEvent], session.exec(statement).all())


def list_events_for_run_step(
    session: Session,
    run_id: str,
    step_id: str,
    before_id: int | None = None,
    after_id: int | None = None,
    limit: int = 100,
) -> list[OrchestratorEvent]:
    """Return a cursor-bounded page for one run step in persistence order."""
    statement = select(OrchestratorEvent).where(
        OrchestratorEvent.run_id == run_id,
        OrchestratorEvent.step_id == step_id,
    )
    if after_id is not None:
        statement = statement.where(col(OrchestratorEvent.id) > after_id).order_by(
            col(OrchestratorEvent.id)
        )
        return cast(
            list[OrchestratorEvent],
            session.exec(statement.limit(limit)).all(),
        )

    if before_id is not None:
        statement = statement.where(col(OrchestratorEvent.id) < before_id)
    rows = cast(
        list[OrchestratorEvent],
        session.exec(statement.order_by(col(OrchestratorEvent.id).desc()).limit(limit)).all(),
    )
    rows.reverse()
    return rows
