import pytest
from pydantic import ValidationError

from ihub_server.core.environment import SeedBrokerConnection, Settings


def test_uvicorn_workers_defaults_to_one(monkeypatch):
    monkeypatch.delenv("UVICORN_WORKERS", raising=False)

    assert Settings(_env_file=None).UVICORN_WORKERS == 1


def test_uvicorn_workers_accepts_explicit_one(monkeypatch):
    monkeypatch.setenv("UVICORN_WORKERS", "1")

    assert Settings(_env_file=None).UVICORN_WORKERS == 1


def test_uvicorn_workers_rejects_multiple_workers(monkeypatch):
    monkeypatch.setenv("UVICORN_WORKERS", "2")

    with pytest.raises(ValidationError, match="UVICORN_WORKERS"):
        Settings(_env_file=None)


def test_project_file_upload_limit_defaults_to_ten_mib(monkeypatch):
    monkeypatch.delenv("PROJECT_FILE_UPLOAD_MAX_BYTES", raising=False)

    assert Settings(_env_file=None).PROJECT_FILE_UPLOAD_MAX_BYTES == 10 * 1024 * 1024


def test_project_file_upload_limit_accepts_positive_override(monkeypatch):
    monkeypatch.setenv("PROJECT_FILE_UPLOAD_MAX_BYTES", "2048")

    assert Settings(_env_file=None).PROJECT_FILE_UPLOAD_MAX_BYTES == 2048


def test_project_file_upload_limit_rejects_non_positive_override(monkeypatch):
    monkeypatch.setenv("PROJECT_FILE_UPLOAD_MAX_BYTES", "0")

    with pytest.raises(ValidationError, match="PROJECT_FILE_UPLOAD_MAX_BYTES"):
        Settings(_env_file=None)


_SEED_BROKER_ENV = {
    "BROKER_HOST": "broker.example.com",
    "BROKER_PORT": "5672",
    "BROKER_USERNAME": "user",
    "BROKER_PASSWORD": "pass",
    "BROKER_PROTOCOL": "amqp0.9.1",
}


def test_broker_settings_are_optional_when_seed_broker_disabled(monkeypatch):
    monkeypatch.delenv("BROKER_ENABLED", raising=False)
    for name in _SEED_BROKER_ENV:
        monkeypatch.delenv(name, raising=False)

    settings = Settings(_env_file=None)

    assert settings.BROKER_ENABLED is False
    assert settings.BROKER_HOST is None


def test_seed_broker_requires_connection_settings(monkeypatch):
    monkeypatch.setenv("BROKER_ENABLED", "true")
    monkeypatch.setenv("BROKER_HOST", "broker.example.com")
    for name in ("BROKER_PORT", "BROKER_USERNAME", "BROKER_PASSWORD", "BROKER_PROTOCOL"):
        monkeypatch.delenv(name, raising=False)

    with pytest.raises(
        ValidationError,
        match="BROKER_PORT, BROKER_USERNAME, BROKER_PASSWORD, BROKER_PROTOCOL",
    ):
        Settings(_env_file=None)


def test_seed_broker_connection_returns_configured_values(monkeypatch):
    monkeypatch.setenv("BROKER_ENABLED", "true")
    for name, value in _SEED_BROKER_ENV.items():
        monkeypatch.setenv(name, value)

    connection = Settings(_env_file=None).seed_broker_connection()

    assert connection == SeedBrokerConnection(
        host="broker.example.com",
        port=5672,
        username="user",
        password="pass",
        protocol="amqp0.9.1",
    )


_KEYCLOAK_URLS = (
    "KEYCLOAK_AUTHORIZE_URL",
    "KEYCLOAK_TOKEN_URL",
    "KEYCLOAK_JWKS_URL",
)


@pytest.fixture(autouse=True)
def clear_legacy_keycloak_urls(monkeypatch):
    for name in _KEYCLOAK_URLS:
        monkeypatch.delenv(name.lower(), raising=False)


_KEYCLOAK_SETTINGS = (
    "KEYCLOAK_AUTHORIZE_URL",
    "KEYCLOAK_TOKEN_URL",
    "KEYCLOAK_JWKS_URL",
    "SCOPE",
    "CLIENT_ID",
    "CLIENT_SECRET",
)


def test_keycloak_settings_are_optional_in_dev_bypass(monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "dev_bypass")
    for name in _KEYCLOAK_SETTINGS:
        monkeypatch.delenv(name, raising=False)

    settings = Settings(_env_file=None)

    assert settings.CLIENT_ID is None
    for name in _KEYCLOAK_URLS:
        assert getattr(settings, name) is None


def test_oauth_mode_requires_keycloak_settings(monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "oauth")
    monkeypatch.delenv("CLIENT_SECRET", raising=False)
    monkeypatch.delenv("KEYCLOAK_JWKS_URL", raising=False)

    with pytest.raises(ValidationError, match="CLIENT_SECRET, KEYCLOAK_JWKS_URL"):
        Settings(_env_file=None)


@pytest.mark.parametrize("source", ["environment", "dotenv"])
@pytest.mark.parametrize(
    "scenario",
    ["legacy", "canonical", "mixed", "conflict", "empty_canonical"],
)
def test_keycloak_url_aliases(monkeypatch, tmp_path, source, scenario):
    monkeypatch.setenv("AUTH_MODE", "oauth")
    variables = {}
    expected = {}
    for index, name in enumerate(_KEYCLOAK_URLS):
        # Remove conftest's canonical values so legacy-only and dotenv cases
        # actually exercise the aliases rather than inheriting valid settings.
        monkeypatch.delenv(name, raising=False)
        legacy_value = f"https://legacy.example.test/{name.lower()}"
        canonical_value = f"https://canonical.example.test/{name.lower()}"
        if scenario in {"legacy", "conflict", "empty_canonical"} or (
            scenario == "mixed" and index % 2 == 0
        ):
            variables[name.lower()] = legacy_value
            expected[name] = legacy_value
        if scenario in {"canonical", "conflict"} or (scenario == "mixed" and index % 2 == 1):
            variables[name] = canonical_value
            expected[name] = canonical_value
        if scenario == "empty_canonical":
            variables[name] = ""

    env_file = None
    if source == "environment":
        for name, value in variables.items():
            monkeypatch.setenv(name, value)
    else:
        env_file = tmp_path / ".env"
        env_file.write_text("\n".join(f"{name}={value}" for name, value in variables.items()))

    settings = Settings(_env_file=env_file)

    for name, value in expected.items():
        assert getattr(settings, name) == value


@pytest.mark.parametrize("source", ["environment", "dotenv"])
@pytest.mark.parametrize("name", _KEYCLOAK_URLS)
def test_oauth_rejects_empty_keycloak_url_aliases(monkeypatch, tmp_path, source, name):
    monkeypatch.setenv("AUTH_MODE", "oauth")
    monkeypatch.delenv(name, raising=False)
    env_file = None
    if source == "environment":
        monkeypatch.setenv(name, "")
        monkeypatch.setenv(name.lower(), "")
    else:
        env_file = tmp_path / ".env"
        env_file.write_text(f"{name}=\n{name.lower()}=\n")

    with pytest.raises(ValidationError, match=name):
        Settings(_env_file=env_file)
