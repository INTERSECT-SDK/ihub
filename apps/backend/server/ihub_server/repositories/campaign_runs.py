"""Repository helpers for campaign run history."""

from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy import delete, desc, or_, update
from sqlmodel import Session, select

from ihub_server.models.campaign_run import (
    CampaignRun,
    CampaignRunCreate,
    CampaignRunOutcome,
    CampaignRunStatus,
)


def create_run(session: Session, run: CampaignRunCreate) -> CampaignRun:
    db_run = CampaignRun.model_validate(run)
    session.add(db_run)
    session.commit()
    session.refresh(db_run)
    return db_run


def list_runs(
    session: Session,
    user_email: str,
    campaign_id: str | None,
    statuses: list[CampaignRunStatus] | None,
    offset: int,
    limit: int,
    campaign_name: str | None = None,
    search: str | None = None,
) -> list[CampaignRun]:
    statement = select(CampaignRun).where(CampaignRun.user_email == user_email)
    if campaign_id:
        statement = statement.where(CampaignRun.campaign_id == campaign_id)
    normalized_campaign_name = campaign_name.strip() if campaign_name else ""
    if normalized_campaign_name:
        statement = statement.where(
            cast(Any, CampaignRun.campaign_name).icontains(
                normalized_campaign_name,
                autoescape=True,
            )
        )
    normalized_search = search.strip() if search else ""
    if normalized_search:
        statement = statement.where(
            or_(
                cast(Any, CampaignRun.campaign_name).icontains(
                    normalized_search,
                    autoescape=True,
                ),
                cast(Any, CampaignRun.run_id).icontains(
                    normalized_search,
                    autoescape=True,
                ),
            )
        )
    if statuses:
        statement = statement.where(
            cast(Any, CampaignRun.status).in_([status.value for status in statuses])
        )
    statement = statement.order_by(desc(cast(Any, CampaignRun.run_at))).offset(offset).limit(limit)
    return cast(list[CampaignRun], session.exec(statement).all())


def get_run_by_run_id(
    session: Session,
    user_email: str,
    run_id: str,
) -> CampaignRun | None:
    statement = select(CampaignRun).where(
        CampaignRun.user_email == user_email,
        CampaignRun.run_id == run_id,
    )
    return session.exec(statement).first()


def get_run_by_run_id_and_broker(
    session: Session,
    run_id: str,
    broker_id: int,
) -> CampaignRun | None:
    """Return a run using the broker-scoped orchestrator identity."""
    statement = select(CampaignRun).where(
        CampaignRun.run_id == run_id,
        CampaignRun.broker_id == broker_id,
    )
    return session.exec(statement).first()


def list_active_broker_ids(session: Session) -> list[int]:
    """Return distinct brokers that have campaign runs awaiting terminal events."""
    statement = (
        select(CampaignRun.broker_id)
        .where(
            CampaignRun.broker_id.is_not(None),  # type: ignore[union-attr]
            CampaignRun.status == CampaignRunStatus.ACTIVE.value,
        )
        .distinct()
    )
    return [broker_id for broker_id in session.exec(statement).all() if broker_id is not None]


def has_active_runs_for_broker(session: Session, broker_id: int) -> bool:
    """Return whether a broker still has a run requiring event consumption."""
    statement = (
        select(CampaignRun.id)
        .where(
            CampaignRun.broker_id == broker_id,
            CampaignRun.status == CampaignRunStatus.ACTIVE.value,
        )
        .limit(1)
    )
    return session.exec(statement).first() is not None


def abort_active_runs_for_broker(session: Session, broker_id: int) -> None:
    """Abort every active run for a broker that can no longer be reached."""
    statement = (
        update(CampaignRun)
        .where(
            cast(Any, CampaignRun.broker_id) == broker_id,
            cast(Any, CampaignRun.status) == CampaignRunStatus.ACTIVE.value,
        )
        .values(
            status=CampaignRunStatus.ABORTED.value,
            outcome=CampaignRunOutcome.INTERRUPTED.value,
            ended_at=datetime.now(UTC),
        )
        .execution_options(synchronize_session=False)
    )
    session.exec(statement)
    session.commit()


def list_active_runs_by_campaign_and_broker(
    session: Session,
    campaign_id: str,
    broker_id: int,
    limit: int = 2,
) -> list[CampaignRun]:
    """Return active runs usable for safe terminal-event fallback matching."""
    statement = (
        select(CampaignRun)
        .where(
            CampaignRun.campaign_id == campaign_id,
            CampaignRun.broker_id == broker_id,
            CampaignRun.status == CampaignRunStatus.ACTIVE.value,
        )
        .order_by(desc(cast(Any, CampaignRun.run_at)))
        .limit(limit)
    )
    return cast(list[CampaignRun], session.exec(statement).all())


def list_active_runs_by_broker(
    session: Session,
    broker_id: int,
    limit: int = 2,
) -> list[CampaignRun]:
    """Return active runs usable when a broker event has no identifiers."""
    statement = (
        select(CampaignRun)
        .where(
            CampaignRun.broker_id == broker_id,
            CampaignRun.status == CampaignRunStatus.ACTIVE.value,
        )
        .order_by(desc(cast(Any, CampaignRun.run_at)))
        .limit(limit)
    )
    return cast(list[CampaignRun], session.exec(statement).all())


def transition_active_run(
    session: Session,
    run_id: str,
    status: CampaignRunStatus,
    *,
    outcome: CampaignRunOutcome | None = None,
    user_email: str | None = None,
    broker_id: int | None = None,
    ended_at: datetime | None = None,
) -> CampaignRun | None:
    """Apply the first terminal transition to a matching active run."""
    match_statement = select(CampaignRun).where(CampaignRun.run_id == run_id)
    update_statement = update(CampaignRun).where(
        cast(Any, CampaignRun.run_id) == run_id,
        cast(Any, CampaignRun.status) == CampaignRunStatus.ACTIVE.value,
    )
    if user_email is not None:
        match_statement = match_statement.where(CampaignRun.user_email == user_email)
        update_statement = update_statement.where(cast(Any, CampaignRun.user_email) == user_email)
    if broker_id is not None:
        match_statement = match_statement.where(CampaignRun.broker_id == broker_id)
        update_statement = update_statement.where(cast(Any, CampaignRun.broker_id) == broker_id)

    session.exec(
        update_statement.values(
            status=status.value,
            outcome=outcome.value if outcome is not None else None,
            ended_at=ended_at or datetime.now(UTC),
        )
    )
    session.commit()
    return session.exec(match_statement).first()


def delete_active_run(
    session: Session,
    run_id: str,
    broker_id: int,
    *,
    user_email: str | None = None,
) -> bool:
    """Delete a rejected pre-start row only while it remains active."""
    statement = delete(CampaignRun).where(
        cast(Any, CampaignRun.run_id) == run_id,
        cast(Any, CampaignRun.broker_id) == broker_id,
        cast(Any, CampaignRun.status) == CampaignRunStatus.ACTIVE.value,
    )
    if user_email is not None:
        statement = statement.where(cast(Any, CampaignRun.user_email) == user_email)

    result = session.exec(statement)
    session.commit()
    return bool(result.rowcount)
