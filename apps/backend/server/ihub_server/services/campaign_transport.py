"""HTTP transport boundary for orchestrator campaign lifecycle requests."""

from typing import Any

import httpx


class CampaignTransportError(Exception):
    """Base failure raised by the orchestrator transport."""


class CampaignStartRejectedError(CampaignTransportError):
    """An orchestrator rejected a start request with an HTTP status."""

    def __init__(self, status_code: int, response_text: str) -> None:
        super().__init__(f"Orchestrator returned HTTP {status_code}")
        self.status_code = status_code
        self.response_text = response_text


class CampaignStartRequestError(CampaignTransportError):
    """A start request could not reach the orchestrator."""


class CampaignStopRejectedError(CampaignTransportError):
    """An orchestrator rejected a stop request with an HTTP status."""


class OrchestratorCampaignTransport:
    """Submit focused start and stop requests to an orchestrator HTTP API."""

    @staticmethod
    def _headers(api_key: str) -> dict[str, str]:
        return {
            "Authorization": api_key,
            "Content-Type": "application/json",
        }

    async def start_campaign(
        self,
        orchestrator_url: str,
        api_key: str,
        campaign_payload: dict[str, Any],
    ) -> Any:
        """Start a compiled campaign and return its decoded response body."""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{orchestrator_url}/v1/orchestrator/start_campaign",
                    headers=self._headers(api_key),
                    json=campaign_payload,
                )
                _ = response.read()
                response.raise_for_status()
            except httpx.HTTPStatusError as err:
                raise CampaignStartRejectedError(
                    err.response.status_code,
                    err.response.text,
                ) from err
            except httpx.RequestError as err:
                raise CampaignStartRequestError from err
        return response.json()

    async def stop_campaign(
        self,
        orchestrator_url: str,
        api_key: str,
        campaign_run_id: str,
    ) -> Any:
        """Stop an active campaign and return its decoded response body."""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{orchestrator_url}/v1/orchestrator/stop_campaign",
                    headers=self._headers(api_key),
                    json=campaign_run_id,
                )
                response.raise_for_status()
            except httpx.HTTPStatusError as err:
                raise CampaignStopRejectedError(str(err)) from err
        return response.json()
