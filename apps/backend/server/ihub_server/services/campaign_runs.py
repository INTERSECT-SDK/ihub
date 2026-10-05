"""Service layer for campaign run history."""

from sqlmodel import Session

from ihub_server.models.campaign_run import (
    CampaignRun,
    CampaignRunCreate,
    CampaignRunOutcome,
    CampaignRunStatus,
)
from ihub_server.repositories import campaign_runs as run_repository
from ihub_server.services.errors import NotFoundError


class CampaignRunService:
    """Create and query user-scoped campaign run records."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def create_run(self, run: CampaignRunCreate) -> CampaignRun:
        return run_repository.create_run(self._session, run)

    def list_runs(
        self,
        user_email: str,
        campaign_id: str | None,
        statuses: list[CampaignRunStatus] | None,
        offset: int,
        limit: int,
        campaign_name: str | None = None,
        search: str | None = None,
    ) -> list[CampaignRun]:
        return run_repository.list_runs(
            self._session,
            user_email=user_email,
            campaign_id=campaign_id,
            statuses=statuses,
            offset=offset,
            limit=limit,
            campaign_name=campaign_name,
            search=search,
        )

    def get_run_by_run_id(self, user_email: str, run_id: str) -> CampaignRun:
        run = run_repository.get_run_by_run_id(
            self._session,
            user_email=user_email,
            run_id=run_id,
        )
        if not run:
            msg = "Campaign run not found."
            raise NotFoundError(msg)
        return run

    def get_run_by_run_id_and_broker(
        self,
        run_id: str,
        broker_id: int,
    ) -> CampaignRun | None:
        """Return a run for internal broker-scoped event correlation."""
        return run_repository.get_run_by_run_id_and_broker(
            self._session,
            run_id=run_id,
            broker_id=broker_id,
        )

    def list_active_broker_ids(self) -> list[int]:
        """List brokers whose active runs need background event listeners."""
        return run_repository.list_active_broker_ids(self._session)

    def has_active_runs_for_broker(self, broker_id: int) -> bool:
        """Return whether event consumption must remain active for a broker."""
        return run_repository.has_active_runs_for_broker(self._session, broker_id)

    def abort_active_runs_for_broker(self, broker_id: int) -> None:
        """Abort active runs left behind by a broker that no longer exists."""
        run_repository.abort_active_runs_for_broker(self._session, broker_id)

    def get_active_run_for_user(
        self,
        user_email: str,
        run_id: str,
        broker_id: int,
    ) -> CampaignRun:
        """Return a user-owned active run for the requested broker."""
        run = self.get_run_by_run_id(user_email, run_id)
        if run.status != CampaignRunStatus.ACTIVE or run.broker_id != broker_id:
            msg = "Active campaign run not found."
            raise NotFoundError(msg)
        return run

    def list_active_runs_by_campaign_and_broker(
        self,
        campaign_id: str,
        broker_id: int,
        limit: int = 2,
    ) -> list[CampaignRun]:
        """List active fallback candidates for an event without a run ID."""
        return run_repository.list_active_runs_by_campaign_and_broker(
            self._session,
            campaign_id=campaign_id,
            broker_id=broker_id,
            limit=limit,
        )

    def list_active_runs_by_broker(
        self,
        broker_id: int,
        limit: int = 2,
    ) -> list[CampaignRun]:
        """List active fallback candidates for an event without identifiers."""
        return run_repository.list_active_runs_by_broker(
            self._session,
            broker_id=broker_id,
            limit=limit,
        )

    def transition_active_run(
        self,
        run_id: str,
        status: CampaignRunStatus,
        *,
        outcome: CampaignRunOutcome | None = None,
        user_email: str | None = None,
        broker_id: int | None = None,
    ) -> CampaignRun | None:
        """Apply an idempotent active-to-terminal lifecycle transition."""
        return run_repository.transition_active_run(
            self._session,
            run_id,
            status,
            outcome=outcome,
            user_email=user_email,
            broker_id=broker_id,
        )

    def delete_active_run(
        self,
        run_id: str,
        broker_id: int,
        *,
        user_email: str | None = None,
    ) -> bool:
        """Delete a rejected start row unless an event already made it terminal."""
        return run_repository.delete_active_run(
            self._session,
            run_id,
            broker_id,
            user_email=user_email,
        )
