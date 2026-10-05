import asyncio
import logging
from types import SimpleNamespace

import httpx
import pytest

from ihub_server.models import OrchestratorHealthStatus
from ihub_server.services import brokers as brokers_module
from ihub_server.services.brokers import BrokerOrchestratorHealthService
from ihub_server.services.errors import NotFoundError


def _broker(orchestrator_url="http://orchestrator", api_key="secret-key"):
    return SimpleNamespace(
        orchestrator_url=orchestrator_url,
        orchestrator_api_key=api_key,
    )


class _FakeAsyncClient:
    def __init__(self, captured, *, response=None, error=None, **kwargs):
        captured["client_kwargs"] = kwargs
        self._captured = captured
        self._response = response
        self._error = error

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, url, **kwargs):
        self._captured["url"] = url
        self._captured["request_kwargs"] = kwargs
        if self._error:
            raise self._error
        return self._response


def _service(broker):
    broker_service = SimpleNamespace(get_broker=lambda _broker_id: broker)
    return BrokerOrchestratorHealthService(broker_service)


def test_health_check_propagates_missing_broker_without_request(monkeypatch):
    def get_broker(_broker_id):
        raise NotFoundError("Broker not found")

    class UnexpectedClient:
        def __init__(self, **_kwargs):
            raise AssertionError("HTTP client should not be created")

    monkeypatch.setattr(brokers_module.httpx, "AsyncClient", UnexpectedClient)
    service = BrokerOrchestratorHealthService(SimpleNamespace(get_broker=get_broker))

    with pytest.raises(NotFoundError, match="Broker not found"):
        asyncio.run(service.check(404))


@pytest.mark.parametrize("orchestrator_url", [None, ""])
def test_health_check_returns_not_configured_without_request(monkeypatch, orchestrator_url):
    class UnexpectedClient:
        def __init__(self, **_kwargs):
            raise AssertionError("HTTP client should not be created")

    monkeypatch.setattr(brokers_module.httpx, "AsyncClient", UnexpectedClient)

    status = asyncio.run(_service(_broker(orchestrator_url)).check(1))

    assert status is OrchestratorHealthStatus.NOT_CONFIGURED


@pytest.mark.parametrize("base_url", ["http://orchestrator", "http://orchestrator/"])
def test_health_check_builds_trailing_slash_safe_url_and_uses_five_second_timeout(
    monkeypatch, base_url
):
    captured = {}
    response = httpx.Response(204)
    monkeypatch.setattr(
        brokers_module.httpx,
        "AsyncClient",
        lambda **kwargs: _FakeAsyncClient(captured, response=response, **kwargs),
    )

    status = asyncio.run(_service(_broker(base_url)).check(1))

    assert status is OrchestratorHealthStatus.CONNECTED
    assert captured == {
        "client_kwargs": {"timeout": 5.0},
        "url": "http://orchestrator/v1/healthcheck",
        "request_kwargs": {"headers": {"Authorization": "secret-key"}},
    }


def test_health_check_omits_authorization_when_api_key_is_missing(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        brokers_module.httpx,
        "AsyncClient",
        lambda **kwargs: _FakeAsyncClient(
            captured,
            response=httpx.Response(200),
            **kwargs,
        ),
    )

    status = asyncio.run(_service(_broker(api_key=None)).check(1))

    assert status is OrchestratorHealthStatus.CONNECTED
    assert captured["request_kwargs"] == {"headers": {}}


@pytest.mark.parametrize("status_code", [200, 201, 299])
def test_health_check_maps_any_2xx_response_to_connected(monkeypatch, status_code):
    captured = {}
    monkeypatch.setattr(
        brokers_module.httpx,
        "AsyncClient",
        lambda **kwargs: _FakeAsyncClient(
            captured,
            response=httpx.Response(status_code),
            **kwargs,
        ),
    )

    assert asyncio.run(_service(_broker()).check(1)) is OrchestratorHealthStatus.CONNECTED


@pytest.mark.parametrize("status_code", [300, 401, 500])
def test_health_check_maps_non_2xx_response_to_disconnected(monkeypatch, status_code):
    captured = {}
    monkeypatch.setattr(
        brokers_module.httpx,
        "AsyncClient",
        lambda **kwargs: _FakeAsyncClient(
            captured,
            response=httpx.Response(status_code),
            **kwargs,
        ),
    )

    assert asyncio.run(_service(_broker()).check(1)) is OrchestratorHealthStatus.DISCONNECTED


@pytest.mark.parametrize("error_type", [httpx.TimeoutException, httpx.ConnectError])
def test_health_check_maps_request_failures_to_disconnected(monkeypatch, error_type):
    captured = {}
    request = httpx.Request("GET", "http://orchestrator/v1/healthcheck")
    monkeypatch.setattr(
        brokers_module.httpx,
        "AsyncClient",
        lambda **kwargs: _FakeAsyncClient(
            captured,
            error=error_type("request failed", request=request),
            **kwargs,
        ),
    )

    assert asyncio.run(_service(_broker()).check(1)) is OrchestratorHealthStatus.DISCONNECTED


def test_health_check_maps_invalid_url_to_disconnected(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        brokers_module.httpx,
        "AsyncClient",
        lambda **kwargs: _FakeAsyncClient(
            captured,
            error=httpx.InvalidURL("invalid URL"),
            **kwargs,
        ),
    )

    assert asyncio.run(_service(_broker()).check(1)) is OrchestratorHealthStatus.DISCONNECTED


def test_health_check_logs_no_credentials_or_upstream_body(monkeypatch, caplog):
    captured = {}
    response = httpx.Response(500, content=b"sensitive-upstream-body")
    monkeypatch.setattr(
        brokers_module.httpx,
        "AsyncClient",
        lambda **kwargs: _FakeAsyncClient(captured, response=response, **kwargs),
    )
    logger = logging.getLogger("ihub-server")
    original_handlers = logger.handlers[:]
    original_level = logger.level
    logger.addHandler(caplog.handler)
    logger.setLevel(logging.INFO)
    try:
        status = asyncio.run(_service(_broker(api_key="sensitive-api-key")).check(7))
    finally:
        logger.handlers = original_handlers
        logger.setLevel(original_level)

    assert status is OrchestratorHealthStatus.DISCONNECTED
    assert "broker 7: disconnected" in caplog.text
    assert "sensitive-api-key" not in caplog.text
    assert "sensitive-upstream-body" not in caplog.text
