import os
import pathlib

import pytest
from fastapi.testclient import TestClient

from . import TEST_DATA_DIR

# Provide required settings so Settings() creation in the app import does not fail during tests.
_REQUIRED_SETTINGS = {
    "POSTGRESQL_USERNAME": "user",
    "POSTGRESQL_PASSWORD": "pass",
    "POSTGRESQL_HOST": "localhost",
    "POSTGRESQL_PORT": "5432",
    "POSTGRESQL_DATABASE": "ihub_test",
    "SESSION_SECRET": "test-session-secret",
    "keycloak_authorize_url": "https://example.com/auth",
    "keycloak_token_url": "https://example.com/token",
    "SCOPE": "openid",
    "CLIENT_ID": "test-client",
    "CLIENT_SECRET": "test-secret",
    "keycloak_jwks_url": "https://example.com/jwks",
    "OAUTH_REDIRECT_URL": "https://example.com/redirect",
    "OAUTH_CALLBACK_URL": "https://example.com/callback",
    "OAUTH_UNAUTHORIZED_REDIRECT_URL": "https://example.com/unauthorized",
    "OAUTH_USERDATA_URL": "https://example.com/userinfo",
    "AUTH_MODE": "oauth",
    "ENVIRONMENT": "development",
    "ALEMBIC_RUN_MIGRATIONS": "false",
}

for _key, _value in _REQUIRED_SETTINGS.items():
    os.environ.setdefault(_key, _value)


@pytest.fixture
def random_number_campaign():
    """
    Campaign JSON for random number service.
    """
    return pathlib.Path(TEST_DATA_DIR, "campaign", "random-number-campaign.campaign.json")


@pytest.fixture
def random_number_and_histogram_campaign():
    """
    Campaign JSON with random number service and histogram viz.
    """
    return pathlib.Path(
        TEST_DATA_DIR, "campaign", "random-number-and-histogram-campaign.campaign.json"
    )


class DummyRedis:
    def json(self) -> "DummyRedis":
        return self

    async def get(self, *_args, **_kwargs):
        return None

    async def set(self, *_args, **_kwargs):
        return None

    def ping(self) -> bool:
        return False

    async def close(self) -> None:
        return None


class DummyIntersectClient:
    def __init__(self, connected: bool = True) -> None:
        self._connected = connected

    def is_connected(self) -> bool:
        return self._connected


@pytest.fixture
def connected_intersect_client():
    return DummyIntersectClient(connected=True)


@pytest.fixture
def disconnected_intersect_client():
    return DummyIntersectClient(connected=False)


@pytest.fixture
def app(monkeypatch):
    from ihub_server import main as main_module

    async def fake_init_redis_pool():
        return DummyRedis()

    class DummyCampaignEventManager:
        def __init__(self, _session_factory):
            pass

        async def start(self):
            return None

        async def shutdown(self):
            return None

    monkeypatch.setattr(main_module, "init_redis_pool", fake_init_redis_pool)
    monkeypatch.setattr(main_module, "run_migrations", lambda: None)
    monkeypatch.setattr(main_module, "CampaignEventManager", DummyCampaignEventManager)

    main_module.app.state.intersect_client = DummyIntersectClient(connected=True)
    return main_module.app


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client
