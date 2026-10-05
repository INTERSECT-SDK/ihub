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
