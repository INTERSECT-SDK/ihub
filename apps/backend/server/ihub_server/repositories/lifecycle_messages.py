"""Repository helpers for upserting and listing lifecycle broker messages."""

from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.postgresql.dml import Insert as PostgreSQLInsert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.dialects.sqlite.dml import Insert as SQLiteInsert
from sqlmodel import Session, col, select

from ihub_server.models import Capability, LifecycleMessage, Service
from ihub_server.models.lifecycle_message import LIFECYCLE_MESSAGE_CONTEXT_CONSTRAINT
from ihub_server.repositories import brokers as broker_repository
from ihub_server.utils.lifecycle_message import LifecycleMessageIdentity, ParsedBrokerMessage

_CONTEXT_COLUMNS = (
    "broker_id",
    "organization",
    "facility",
    "system",
    "subsystem",
    "service",
    "sdk_capability_name",
)


def _build_postgresql_upsert(values: dict[str, Any]) -> PostgreSQLInsert:
    insert_statement = postgresql_insert(LifecycleMessage).values(**values)
    return insert_statement.on_conflict_do_update(
        constraint=LIFECYCLE_MESSAGE_CONTEXT_CONSTRAINT,
        set_={
            "message_id": insert_statement.excluded.message_id,
            "endpoint_names": insert_statement.excluded.endpoint_names,
            "last_updated": insert_statement.excluded.last_updated,
        },
    )


def _build_sqlite_upsert(values: dict[str, Any]) -> SQLiteInsert:
    insert_statement = sqlite_insert(LifecycleMessage).values(**values)
    return insert_statement.on_conflict_do_update(
        index_elements=_CONTEXT_COLUMNS,
        set_={
            "message_id": insert_statement.excluded.message_id,
            "endpoint_names": insert_statement.excluded.endpoint_names,
            "last_updated": insert_statement.excluded.last_updated,
        },
    )


def create_lifecycle_message(
    session: Session,
    parsed_message: ParsedBrokerMessage,
    *,
    commit: bool = True,
) -> LifecycleMessage:
    """Create or refresh the lifecycle row for a capability context."""
    last_updated = datetime.now(UTC)
    db_message = LifecycleMessage.model_validate(
        parsed_message,
        update={"last_updated": last_updated},
    )
    values = db_message.model_dump(exclude={"id"})
    dialect_name = session.get_bind().dialect.name

    if dialect_name == "postgresql":
        upsert_statement = _build_postgresql_upsert(values)
        db_message = session.scalars(upsert_statement.returning(LifecycleMessage)).one()
    elif dialect_name == "sqlite":
        sqlite_upsert_statement = _build_sqlite_upsert(values)
        db_message = session.scalars(sqlite_upsert_statement.returning(LifecycleMessage)).one()
    else:
        msg = f"Lifecycle message upsert does not support database dialect {dialect_name!r}"
        raise NotImplementedError(msg)

    if commit:
        session.commit()
        session.refresh(db_message)
    else:
        session.flush()
    return db_message


def list_lifecycle_messages(
    session: Session,
    broker_id: int | None,
    offset: int,
    limit: int,
) -> list[LifecycleMessage]:
    statement = select(LifecycleMessage)
    if broker_id is not None:
        statement = statement.where(LifecycleMessage.broker_id == broker_id)
    return cast(
        list[LifecycleMessage],
        session.exec(statement.offset(offset).limit(limit)).all(),
    )


def record_ingest_error(
    session: Session,
    identity: LifecycleMessageIdentity,
    error_message: str,
    received_at: datetime,
) -> bool:
    """Record an attributable failure without replacing successful metadata."""
    broker = broker_repository.get_broker(session, identity.broker_id)
    if broker is None or broker.status != "connected":
        return False

    hierarchy = identity.hierarchy
    statement = (
        select(Capability)
        .join(Service, col(Service.id) == col(Capability.service_id))
        .where(
            Capability.broker_id == identity.broker_id,
            Capability.name == identity.sdk_capability_name,
            Service.broker_id == identity.broker_id,
            Service.organization == hierarchy.organization,
            Service.facility == hierarchy.facility,
            Service.system == hierarchy.system,
            Service.subsystem == hierarchy.subsystem,
            Service.name == hierarchy.service,
        )
    )
    capability = session.exec(statement).one_or_none()
    if capability is None:
        return False

    capability.lifecycle_error = error_message
    capability.lifecycle_error_at = received_at
    lifecycle_statement = select(LifecycleMessage).where(
        LifecycleMessage.broker_id == identity.broker_id,
        LifecycleMessage.organization == hierarchy.organization,
        LifecycleMessage.facility == hierarchy.facility,
        LifecycleMessage.system == hierarchy.system,
        LifecycleMessage.subsystem == hierarchy.subsystem,
        LifecycleMessage.service == hierarchy.service,
        LifecycleMessage.sdk_capability_name == identity.sdk_capability_name,
    )
    lifecycle_message = session.exec(lifecycle_statement).one_or_none()
    if lifecycle_message is not None:
        lifecycle_message.message_id = identity.message_id
        lifecycle_message.last_updated = received_at
        session.add(lifecycle_message)

    session.add(capability)
    session.commit()
    return True
