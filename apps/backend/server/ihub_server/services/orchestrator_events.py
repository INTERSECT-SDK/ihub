"""Service layer for orchestrator event CRUD and queries."""

from sqlmodel import Session

from ihub_server.models.campaign_run import (
    CampaignRun,
    CampaignRunOutcome,
    CampaignRunStatus,
)
from ihub_server.models.orchestrator_event import (
    OrchestratorEvent,
    OrchestratorEventCreate,
)
from ihub_server.repositories import orchestrator_events as event_repository
from ihub_server.services.errors import NotFoundError


class OrchestratorEventService:
    def __init__(self, session: Session) -> None:
        self._session = session

    def create_event(self, event: OrchestratorEventCreate) -> OrchestratorEvent:
        return event_repository.create_event(self._session, event)

    def record_correlated_event(
        self,
        event: OrchestratorEventCreate,
        run: CampaignRun,
        terminal_status: CampaignRunStatus | None = None,
        terminal_outcome: CampaignRunOutcome | None = None,
    ) -> OrchestratorEvent:
        """Persist a correlated event and run transition in one transaction."""
        return event_repository.record_correlated_event(
            self._session,
            event,
            run,
            terminal_status,
            terminal_outcome,
        )

    def get_event(self, event_id: int) -> OrchestratorEvent:
        event = event_repository.get_event(self._session, event_id)
        if not event:
            msg = "Event not found."
            raise NotFoundError(msg)
        return event

    def list_events(
        self, campaign_id: str | None = None, step_id: str | None = None, run_id: str | None = None
    ) -> list[OrchestratorEvent]:
        return event_repository.list_events(self._session, campaign_id, step_id, run_id)

    def list_events_for_run(self, run_id: str) -> list[OrchestratorEvent]:
        """List exact-run events in deterministic replay order."""
        return event_repository.list_events_for_run(self._session, run_id)

    def list_events_for_run_step(
        self,
        run_id: str,
        step_id: str,
        before_id: int | None = None,
        after_id: int | None = None,
        limit: int = 100,
    ) -> list[OrchestratorEvent]:
        """List one cursor-bounded page for an exact-run campaign step."""
        return event_repository.list_events_for_run_step(
            self._session,
            run_id,
            step_id,
            before_id,
            after_id,
            limit,
        )
