from dataclasses import dataclass
from typing import Any, Literal, Self

from intersect_sdk_common import ControlProvider
from pydantic import AliasChoices, Field, PositiveInt, model_validator
from pydantic.fields import FieldInfo
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
)

LogLevel = Literal["CRITICAL", "FATAL", "ERROR", "WARNING", "WARN", "INFO", "DEBUG"]
EnvironmentName = Literal["development", "staging", "production"]
AuthMode = Literal["oauth", "dev_bypass"]


class _OAuthAliasSettingsSource(PydanticBaseSettingsSource):
    """Normalize OAuth aliases while retaining the wrapped source's loading rules."""

    def __init__(self, source: PydanticBaseSettingsSource) -> None:
        super().__init__(source.settings_cls)
        self._source = source

    def get_field_value(self, field: FieldInfo, field_name: str) -> tuple[Any, str, bool]:
        return self._source.get_field_value(field, field_name)

    def __call__(self) -> dict[str, Any]:
        values = self._source()
        # Normalize before merging so alias spelling cannot override source priority.
        for name in (
            "KEYCLOAK_AUTHORIZE_URL",
            "KEYCLOAK_TOKEN_URL",
            "KEYCLOAK_JWKS_URL",
        ):
            legacy_name = name.lower()
            if legacy_name in values:
                legacy_value = values.pop(legacy_name)
                values.setdefault(name, legacy_value)
        return values


@dataclass(frozen=True)
class SeedBrokerConnection:
    """Connection details for the broker seeded on startup (BROKER_ENABLED)."""

    host: str
    port: int
    username: str
    password: str
    protocol: ControlProvider


class Settings(BaseSettings):
    """variables which can be loaded as environment variables."""

    LOG_LEVEL: LogLevel = Field(default="INFO")
    ENVIRONMENT: EnvironmentName = Field(default="development")
    # With the AMQP protocol, we reserve a specific queue on the message broker.
    # Set this uniquely per iHub instance if multiple instances share a broker.
    RESERVED_BROKER_QUEUE_NAME: str = Field(default="ihub-dev-changeme")
    # Campaign event listeners are process-local. Multiple backend workers would
    # create duplicate upstream listeners and inconsistent websocket fan-out.
    UVICORN_WORKERS: int = Field(default=1, ge=1, le=1)
    AUTH_MODE: AuthMode = Field(default="oauth")
    DEV_AUTH_EMAIL: str = Field(default="dev.user@example.com")
    DEV_AUTH_NAME: str = Field(default="Local Dev User")
    PROJECT_FILE_UPLOAD_MAX_BYTES: PositiveInt = Field(default=10 * 1024 * 1024)

    # as an environment variable, represent this as JSON, i.e. '["*"]'
    CORS_ORIGINS: list[str] = ["*"]

    # Seed broker: auto-create and connect a broker on startup. The BROKER_*
    # connection settings are only required when BROKER_ENABLED is true; other
    # brokers are registered at runtime through the API.
    BROKER_ENABLED: bool = False
    BROKER_HOST: str | None = None
    BROKER_PORT: PositiveInt | None = None
    BROKER_USERNAME: str | None = None
    BROKER_PASSWORD: str | None = None
    BROKER_PROTOCOL: ControlProvider | None = None
    BROKER_LABEL: str = "Dev INTERSECT Broker"

    # Orchestrator URL and API key for the seed broker
    ORCHESTRATOR_URL: str | None = None
    ORCHESTRATOR_API_KEY: str | None = None

    # database stuff - advisable to use separate env variables for each, to make deployment engineers' lives easier
    POSTGRESQL_USERNAME: str
    POSTGRESQL_PASSWORD: str
    POSTGRESQL_HOST: str
    POSTGRESQL_PORT: PositiveInt
    POSTGRESQL_DATABASE: str

    SESSION_SECRET: str
    # Keycloak settings are only required when AUTH_MODE=oauth.
    KEYCLOAK_AUTHORIZE_URL: str | None = Field(
        default=None,
        validation_alias=AliasChoices("KEYCLOAK_AUTHORIZE_URL", "keycloak_authorize_url"),
    )
    KEYCLOAK_TOKEN_URL: str | None = Field(
        default=None,
        validation_alias=AliasChoices("KEYCLOAK_TOKEN_URL", "keycloak_token_url"),
    )
    SCOPE: str | None = None
    CLIENT_ID: str | None = None
    CLIENT_SECRET: str | None = None
    KEYCLOAK_JWKS_URL: str | None = Field(
        default=None,
        validation_alias=AliasChoices("KEYCLOAK_JWKS_URL", "keycloak_jwks_url"),
    )
    OAUTH_REDIRECT_URL: str
    OAUTH_CALLBACK_URL: str
    OAUTH_UNAUTHORIZED_REDIRECT_URL: str = "http://localhost:8080/hub/unauthorized"

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        """Preserve source priority across canonical and legacy OAuth names."""
        return tuple(
            _OAuthAliasSettingsSource(source)
            for source in super().settings_customise_sources(
                settings_cls, init_settings, env_settings, dotenv_settings, file_secret_settings
            )
        )

    def seed_broker_connection(self) -> SeedBrokerConnection:
        """Return the seed broker connection settings, or raise if any are unset."""
        host, port = self.BROKER_HOST, self.BROKER_PORT
        username, password = self.BROKER_USERNAME, self.BROKER_PASSWORD
        protocol = self.BROKER_PROTOCOL
        if host is None or port is None or username is None or password is None or protocol is None:
            missing = [
                name
                for name in (
                    "BROKER_HOST",
                    "BROKER_PORT",
                    "BROKER_USERNAME",
                    "BROKER_PASSWORD",
                    "BROKER_PROTOCOL",
                )
                if getattr(self, name) is None
            ]
            msg = f"BROKER_ENABLED=true requires {', '.join(missing)} to be set"
            raise ValueError(msg)
        return SeedBrokerConnection(
            host=host, port=port, username=username, password=password, protocol=protocol
        )

    @model_validator(mode="after")
    def _require_seed_broker_connection(self) -> Self:
        if self.BROKER_ENABLED:
            self.seed_broker_connection()
        return self

    @model_validator(mode="after")
    def _require_keycloak_settings(self) -> Self:
        if self.AUTH_MODE != "oauth":
            return self
        keycloak_settings = (
            "KEYCLOAK_AUTHORIZE_URL",
            "KEYCLOAK_TOKEN_URL",
            "SCOPE",
            "CLIENT_ID",
            "CLIENT_SECRET",
            "KEYCLOAK_JWKS_URL",
        )
        missing = [name for name in keycloak_settings if getattr(self, name) is None]
        if missing:
            msg = f"AUTH_MODE=oauth requires {', '.join(missing)} to be set"
            raise ValueError(msg)
        return self

    @property
    def postgres_url(self) -> str:
        return f"postgresql+psycopg://{self.POSTGRESQL_USERNAME}:{self.POSTGRESQL_PASSWORD}@{self.POSTGRESQL_HOST}:{self.POSTGRESQL_PORT}/{self.POSTGRESQL_DATABASE}"

    ALEMBIC_RUN_MIGRATIONS: bool = True
    """If this is set to True, this assumes that all migrations present are desirable and should be upgraded.
    
    The only time you would really set this to False would be if you need to manually run `alembic downgrade` and do
    NOT want the latest migrations restored. You would only realistically do this temporarily.
    Also note that the correct way to fix a bad migration is to create a new migration which restores it; in general, you never want to delete migration files.
    
    It's plausible that we may not be able to autorun migrations ourselves, in which case this can safely be set to False.
    """

    # pydantic config, NOT an environment variable
    model_config = SettingsConfigDict(
        case_sensitive=True,
        frozen=True,
        env_file=".env",  # not used in production; this only needs to exist if you don't have environment variables already set
        extra="ignore",
        validate_default=False,  # I have no idea why pydantic-settings overrides pydantic's default, but we don't need it
        env_ignore_empty=True,  # treat empty ENV strings as None
    )


settings = Settings()
