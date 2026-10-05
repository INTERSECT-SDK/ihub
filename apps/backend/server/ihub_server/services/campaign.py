"""Service for orchestrator campaign start/stop via broker APIs."""

import json
import logging
from typing import Any

from fastapi import WebSocket

from ihub_server.models.campaign_run import (
    CampaignRunCreate,
    CampaignRunOutcome,
    CampaignRunStatus,
)
from ihub_server.services.brokers import BrokerService
from ihub_server.services.campaign_compilation import CampaignCompiler
from ihub_server.services.campaign_events import CampaignEventManager
from ihub_server.services.campaign_hydration import CampaignHydrator
from ihub_server.services.campaign_run_persistence import CampaignRunPersistence
from ihub_server.services.campaign_transport import (
    CampaignStartRejectedError,
    CampaignStartRequestError,
    CampaignStopRejectedError,
    OrchestratorCampaignTransport,
)
from ihub_server.services.errors import NotFoundError, ServiceError
from ihub_server.services.orchestrator_events import OrchestratorEventService
from ihub_server.services.services import ServiceService

_log = logging.getLogger("ihub-server")


class CampaignService:
    """Coordinates campaign lifecycle operations with orchestrator services."""

    def __init__(
        self,
        broker_service: BrokerService,
        event_service: OrchestratorEventService,
        service_service: ServiceService | None = None,
        run_service: CampaignRunPersistence | None = None,
        event_manager: CampaignEventManager | None = None,
        transport: OrchestratorCampaignTransport | None = None,
    ) -> None:
        """Initialize the service with broker access and event persistence helpers."""
        self._broker_service = broker_service
        self._event_service = event_service
        self._hydrator = CampaignHydrator(service_service)
        self._compiler = CampaignCompiler(self._hydrator)
        self._run_service = run_service
        self._event_manager = event_manager
        self._transport = transport or OrchestratorCampaignTransport()

    async def start_campaign(self, broker_id: int, payload: dict[str, Any], user_email: str):
        """Start a canonical CampaignModel in the broker's orchestrator."""
        campaign = self._compiler.compile(payload)
        broker = self._broker_service.get_broker(broker_id)
        if not broker.orchestrator_url:
            msg = "Missing orchestrator URL."
            raise NotFoundError(msg)
        if not broker.orchestrator_api_key:
            msg = "Missing orchestrator API key."
            raise NotFoundError(msg)

        campaign_payload = campaign.model_dump(by_alias=True)
        campaign_id = campaign_payload.get("id")

        if not self._run_service:
            msg = "Campaign run service is unavailable."
            raise ServiceError(msg)
        if not self._event_manager:
            msg = "Campaign event manager is unavailable."
            raise ServiceError(msg)

        _log.info("sending campaign to orchestrator...\n%s", json.dumps(campaign_payload, indent=2))

        async with self._event_manager.hold_listener_for_start(broker_id):
            self._run_service.create_run(
                CampaignRunCreate(
                    user_email=user_email,
                    campaign_id=campaign.id,
                    run_id=campaign.run_id,
                    orchestrator_url=broker.orchestrator_url,
                    campaign_name=campaign.name,
                    broker_id=broker_id,
                    submitted_campaign_snapshot=payload,
                    orchestrator_campaign_snapshot=campaign_payload,
                )
            )
            try:
                orchestrator_response = await self._transport.start_campaign(
                    broker.orchestrator_url,
                    broker.orchestrator_api_key,
                    campaign_payload,
                )
            except CampaignStartRejectedError as err:
                self._run_service.delete_active_run(
                    campaign.run_id,
                    broker_id,
                    user_email=user_email,
                )
                _log.error(
                    "Orchestrator rejected campaign start for broker %s with status %s: %s",
                    broker_id,
                    err.status_code,
                    err.response_text,
                )
                msg = "Unable to start the campaign with the orchestrator."
                raise ServiceError(msg) from err.__cause__
            except CampaignStartRequestError as err:
                self._run_service.delete_active_run(
                    campaign.run_id,
                    broker_id,
                    user_email=user_email,
                )
                _log.exception(
                    "Failed to submit campaign start request for broker %s",
                    broker_id,
                )
                msg = "Unable to start the campaign with the orchestrator."
                raise ServiceError(msg) from err.__cause__

        if isinstance(orchestrator_response, dict):
            return {
                **orchestrator_response,
                "campaign_id": campaign_id,
                "run_id": campaign.run_id,
            }

        return {
            "campaign_id": campaign_id,
            "run_id": campaign.run_id,
            "orchestrator_response": orchestrator_response,
        }

    async def stop_campaign(
        self,
        broker_id: int,
        campaign_run_id: str,
        user_email: str,
    ):
        """Stop an active campaign in the broker's orchestrator."""
        broker = self._broker_service.get_broker(broker_id)
        if not broker.orchestrator_url:
            msg = "Missing orchestrator URL."
            raise NotFoundError(msg)
        if not broker.orchestrator_api_key:
            msg = "Missing orchestrator API key."
            raise NotFoundError(msg)
        if not self._run_service:
            msg = "Campaign run service is unavailable."
            raise ServiceError(msg)

        run = self._run_service.get_run_by_run_id(user_email, campaign_run_id)
        if run.broker_id != broker_id:
            msg = "Campaign run not found."
            raise NotFoundError(msg)

        run_status = run.status.value if isinstance(run.status, CampaignRunStatus) else run.status

        if run.status != CampaignRunStatus.ACTIVE:
            return {
                "status": "already_terminal",
                "run_id": campaign_run_id,
                "run_status": run_status,
            }

        try:
            orchestrator_response = await self._transport.stop_campaign(
                broker.orchestrator_url,
                broker.orchestrator_api_key,
                campaign_run_id,
            )
        except CampaignStopRejectedError as err:
            msg = f"Orchesatrator response error. Error Details: {err}"
            raise ServiceError(msg) from err.__cause__

        self._run_service.transition_active_run(
            campaign_run_id,
            CampaignRunStatus.ABORTED,
            outcome=CampaignRunOutcome.CANCELED,
            user_email=user_email,
            broker_id=broker_id,
        )
        return orchestrator_response

    async def relay_campaign_events(self, broker_id: int, websocket: WebSocket) -> None:
        """Subscribe a browser to the application-lifetime campaign event manager."""
        if not self._event_manager:
            msg = "Campaign event manager is unavailable."
            raise ServiceError(msg)
        await self._event_manager.relay_events(broker_id, websocket)

    def create_event(self, event):
        """Persist a campaign event through the orchestrator event service."""
        return self._event_service.create_event(event)

    def get_event(self, event_id: int):
        """Fetch a single persisted campaign event by its identifier."""
        return self._event_service.get_event(event_id)

    def list_events(
        self, campaign_id: str | None = None, step_id: str | None = None, run_id: str | None = None
    ):
        """List persisted campaign events, optionally filtered by campaign ID, step ID, and run ID."""
        return self._event_service.list_events(campaign_id, step_id, run_id)

    def list_runs(
        self,
        user_email: str,
        campaign_id: str | None,
        statuses: list[CampaignRunStatus] | None,
        offset: int,
        limit: int,
        campaign_name: str | None = None,
        search: str | None = None,
    ):
        """List persisted campaign runs for a user."""
        if not self._run_service:
            msg = "Campaign run service is unavailable."
            raise ServiceError(msg)
        return self._run_service.list_runs(
            user_email,
            campaign_id,
            statuses,
            offset,
            limit,
            campaign_name=campaign_name,
            search=search,
        )

    def get_run_by_run_id(self, user_email: str, run_id: str):
        """Fetch one persisted campaign run for a user."""
        if not self._run_service:
            msg = "Campaign run service is unavailable."
            raise ServiceError(msg)
        return self._run_service.get_run_by_run_id(user_email, run_id)

    def get_run_snapshots(self, user_email: str, run_id: str):
        """Fetch immutable submitted and orchestrator campaign representations."""
        run = self.get_run_by_run_id(user_email, run_id)
        if run.submitted_campaign_snapshot is None or run.orchestrator_campaign_snapshot is None:
            msg = "Campaign snapshots are not available for this run."
            raise NotFoundError(msg)
        submitted_document_kind = (
            "icmp" if "campaignId" in run.submitted_campaign_snapshot else "orchestrator_campaign"
        )
        return {
            "schema_version": 1,
            "run_id": run.run_id,
            "captured_at": run.run_at,
            "submitted_document_kind": submitted_document_kind,
            "submitted_campaign": run.submitted_campaign_snapshot,
            "orchestrator_campaign": run.orchestrator_campaign_snapshot,
        }

    def get_run_recovery(self, user_email: str, run_id: str):
        """Fetch a user-owned run and its deterministic exact-run event replay."""
        if not self._run_service:
            msg = "Campaign run service is unavailable."
            raise ServiceError(msg)
        run = self._run_service.get_run_by_run_id(user_email, run_id)
        events = self._event_service.list_events_for_run(run_id)
        return {"run": run, "events": events}

    def list_run_step_events(
        self,
        user_email: str,
        run_id: str,
        step_id: str,
        before_id: int | None = None,
        after_id: int | None = None,
        limit: int = 100,
    ):
        """List a persisted event page for one step of a user-owned run."""
        if not self._run_service:
            msg = "Campaign run service is unavailable."
            raise ServiceError(msg)
        self._run_service.get_run_by_run_id(user_email, run_id)
        return self._event_service.list_events_for_run_step(
            run_id,
            step_id,
            before_id,
            after_id,
            limit,
        )
