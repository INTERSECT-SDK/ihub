"""Persistence protocol used by CampaignService orchestration."""

from typing import Any, Protocol

from ihub_server.models.campaign_run import (
    CampaignRunCreate,
    CampaignRunOutcome,
    CampaignRunStatus,
)


class CampaignRunPersistence(Protocol):
    """Narrow run persistence operations required by the campaign facade."""

    def create_run(self, campaign_run: CampaignRunCreate) -> Any: ...

    def delete_active_run(
        self,
        run_id: str,
        broker_id: int,
        *,
        user_email: str | None = None,
    ) -> bool: ...

    def get_run_by_run_id(self, user_email: str, run_id: str) -> Any: ...

    def transition_active_run(
        self,
        run_id: str,
        status: CampaignRunStatus,
        *,
        outcome: CampaignRunOutcome | None = None,
        user_email: str | None = None,
        broker_id: int | None = None,
    ) -> Any: ...

    def list_runs(
        self,
        user_email: str,
        campaign_id: str | None,
        statuses: list[CampaignRunStatus] | None,
        offset: int,
        limit: int,
        *,
        campaign_name: str | None = None,
        search: str | None = None,
    ) -> Any: ...
