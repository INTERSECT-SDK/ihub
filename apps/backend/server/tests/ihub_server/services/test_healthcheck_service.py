import pytest

from ihub_server.services.errors import ServiceError
from ihub_server.services.healthcheck import HealthcheckService


class DummyClient:
    def __init__(self, connected: bool):
        self._connected = connected

    def is_connected(self) -> bool:
        return self._connected


def test_check_missing_client():
    service = HealthcheckService()

    with pytest.raises(ServiceError):
        service.check(object())


def test_check_returns_errors():
    service = HealthcheckService()
    app_state = type("AppState", (), {"intersect_client": DummyClient(False)})()

    assert service.check(app_state) == ["not connected"]


def test_check_connected():
    service = HealthcheckService()
    app_state = type("AppState", (), {"intersect_client": DummyClient(True)})()

    assert service.check(app_state) == []
