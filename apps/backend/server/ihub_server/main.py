"""Main file to start iHub backend server."""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware

from .api import router
from .core.environment import settings
from .core.log_config import configure_logging
from .core.run_migrations import run_migrations
from .db import create_session
from .redis import init_redis_pool
from .services.brokers import BrokerConnectionService, BrokerService
from .services.campaign_events import CampaignEventManager
from .services.errors import BrokerConnectionError, ConflictError, NotFoundError
from .services.lifecycle_message_stream import LifecycleMessageStreamManager
from .services.upload_locks import UploadLockManager

# TEST imports
# from .core.intersect_client import CoreServiceIntersectClient

_log = logging.getLogger(__name__)


def _seed_broker(app: FastAPI) -> None:
    """Create (or find) the seed broker and connect it.

    Uses BROKER_* env vars for the connection details and label, and
    ORCHESTRATOR_* for the orchestrator URL.
    """
    connection = settings.seed_broker_connection()
    with create_session() as session:
        broker_service = BrokerService(session)
        brokers = broker_service.list_brokers(offset=0, limit=1)

        if brokers:
            broker = brokers[0]
            _log.info("Seed broker: found existing broker %d (%s)", broker.id, broker.label)
        else:
            from .models import BrokerCreate

            broker = broker_service.create_broker(
                BrokerCreate(
                    label=settings.BROKER_LABEL,
                    hostIP=connection.host,
                    port=str(connection.port),
                    protocol=connection.protocol,
                    username=connection.username,
                    password=connection.password,
                    orchestratorUrl=settings.ORCHESTRATOR_URL,
                    orchestratorApiKey=settings.ORCHESTRATOR_API_KEY,
                )
            )
            _log.info("Seed broker: created broker %d (%s)", broker.id, broker.label)

        broker_id: int = broker.id  # type: ignore[assignment]  # guaranteed after DB insert/fetch
        auto_connect_enabled = broker.auto_connect_enabled

        # Ensure orchestrator URL is up-to-date
        if settings.ORCHESTRATOR_URL:
            from .models import BrokerUpdate

            broker_service.update_broker(
                broker_id,
                BrokerUpdate(
                    orchestratorUrl=settings.ORCHESTRATOR_URL,
                    orchestratorApiKey=settings.ORCHESTRATOR_API_KEY,
                ),
            )

    if not auto_connect_enabled:
        _log.info(
            "Seed broker: broker %d auto-connect disabled; skipping connection",
            broker_id,
        )
        return

    # Connect (separate session so CRUD commits are visible)
    with create_session() as session:
        conn_service = BrokerConnectionService(
            broker_service=BrokerService(session),
            session_factory=create_session,
            lifecycle_publisher=app.state.lifecycle_message_stream.publish,
        )
        try:
            conn_service.connect_broker(broker_id, app.state.intersect_clients)
            _log.info("Seed broker: broker %d connected", broker_id)
        except (BrokerConnectionError, ConflictError, NotFoundError):
            _log.exception("Seed broker: failed to connect broker %d", broker_id)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # On startup
    _log.info("Initializing app")

    # TEST broker defined in .env, only needed to see streaming messages.
    # app.state.intersect_client = CoreServiceIntersectClient(settings)
    # if not app.state.intersect_client.can_reconnect():
    #     _log.critical("Unable to connect to enviornment INTERSECT broker, exiting")
    #     import sys

    #     sys.exit(1)

    # For brokers added through the UI
    app.state.intersect_clients = {}
    app.state.upload_lock_manager = UploadLockManager()
    app.state.lifecycle_message_stream = LifecycleMessageStreamManager()
    await app.state.lifecycle_message_stream.start()

    # Redis
    app.state.redis = await init_redis_pool()

    _log.info("App initialized")

    if settings.ALEMBIC_RUN_MIGRATIONS:
        _log.info("Running migration scripts.")
        run_migrations()
    else:
        _log.warning(
            "Skipping migration scripts. Be advised that this should only be a temporary workaround, and that ALEMBIC_RUN_MIGRATIONS should be set to True for general use cases."
        )

    if settings.BROKER_ENABLED:
        _seed_broker(app)

    app.state.campaign_event_manager = CampaignEventManager(create_session)
    await app.state.campaign_event_manager.start()

    yield

    # On cleanup
    _log.info("Shutting down gracefully")

    await app.state.campaign_event_manager.shutdown()

    # TEST broker defined in .env
    # app.state.intersect_client.terminate()

    # update all broker status in DB
    for client in app.state.intersect_clients.values():
        with create_session() as session:
            broker_service = BrokerService(session)
            broker_service.update_broker_status(client.broker_id, "disconnected")
        client.terminate()

    await app.state.lifecycle_message_stream.shutdown()

    # Close Redis connection
    if app.state.redis.ping():
        await app.state.redis.close()

    _log.info("Graceful shutdown complete")


configure_logging(settings)

if settings.AUTH_MODE == "dev_bypass" and settings.ENVIRONMENT != "development":
    msg = "AUTH_MODE=dev_bypass is only allowed when ENVIRONMENT=development."
    raise RuntimeError(msg)

session_cookie_secure = settings.OAUTH_CALLBACK_URL.lower().startswith("https://")

app = FastAPI(
    title="iHub",
    description="Manage INTERSECT Campaigns and subscribe to messages",
    version=os.getenv("VERSION", "0.25.x"),
    redoc_url="/",  # redoc is better for end users, so it gets the root URL
    docs_url="/docs",  # this is better for actual developers
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

if settings.CORS_ORIGINS:
    from fastapi.middleware.cors import CORSMiddleware

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.add_middleware(
    SessionMiddleware,
    secret_key=settings.SESSION_SECRET,
    max_age=60 * 60 * 24 * 7,
    https_only=session_cookie_secure,
    same_site="lax",
)

# routes
app.include_router(router)
