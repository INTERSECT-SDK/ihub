import asyncio

import httpx
import pytest

from ihub_server.services import campaign_transport as transport_module
from ihub_server.services.campaign_transport import (
    CampaignStartRejectedError,
    CampaignStartRequestError,
    CampaignStopRejectedError,
    OrchestratorCampaignTransport,
)


class _FakeClient:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if self.error:
            raise self.error
        return self.response


def _response(status_code=200, payload=None):
    request = httpx.Request("POST", "http://orchestrator")
    return httpx.Response(
        status_code,
        request=request,
        json=payload if payload is not None else {"status": "ok"},
    )


def test_start_transport_preserves_url_headers_payload_and_response(monkeypatch):
    client = _FakeClient(_response(payload={"accepted": True}))
    monkeypatch.setattr(transport_module.httpx, "AsyncClient", lambda: client)

    result = asyncio.run(
        OrchestratorCampaignTransport().start_campaign(
            "http://orchestrator",
            "secret-key",
            {"id": "campaign"},
        )
    )

    assert result == {"accepted": True}
    assert client.calls == [
        (
            "http://orchestrator/v1/orchestrator/start_campaign",
            {
                "headers": {
                    "Authorization": "secret-key",
                    "Content-Type": "application/json",
                },
                "json": {"id": "campaign"},
            },
        )
    ]


def test_start_transport_exposes_typed_http_failure(monkeypatch):
    response = _response(status_code=422, payload={"detail": "invalid"})
    client = _FakeClient(response)
    monkeypatch.setattr(transport_module.httpx, "AsyncClient", lambda: client)

    with pytest.raises(CampaignStartRejectedError) as exc_info:
        asyncio.run(
            OrchestratorCampaignTransport().start_campaign("http://orchestrator", "key", {})
        )

    assert exc_info.value.status_code == 422
    assert exc_info.value.response_text == '{"detail":"invalid"}'


def test_start_transport_wraps_request_failure(monkeypatch):
    error = httpx.ConnectError(
        "offline",
        request=httpx.Request("POST", "http://orchestrator"),
    )
    monkeypatch.setattr(
        transport_module.httpx,
        "AsyncClient",
        lambda: _FakeClient(error=error),
    )

    with pytest.raises(CampaignStartRequestError):
        asyncio.run(
            OrchestratorCampaignTransport().start_campaign("http://orchestrator", "key", {})
        )


def test_stop_transport_preserves_body_and_typed_http_failure(monkeypatch):
    success_client = _FakeClient(_response(payload={"stopped": True}))
    monkeypatch.setattr(
        transport_module.httpx,
        "AsyncClient",
        lambda: success_client,
    )
    transport = OrchestratorCampaignTransport()

    assert asyncio.run(transport.stop_campaign("http://orchestrator", "key", "run-1")) == {
        "stopped": True
    }
    assert success_client.calls[0][1]["json"] == "run-1"

    rejected_client = _FakeClient(_response(status_code=500))
    monkeypatch.setattr(
        transport_module.httpx,
        "AsyncClient",
        lambda: rejected_client,
    )
    with pytest.raises(CampaignStopRejectedError):
        asyncio.run(transport.stop_campaign("http://orchestrator", "key", "run-1"))
