"""Repository utilities for Capability CRUD and service-scoped queries."""

from typing import Any

from sqlalchemy import and_
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.postgresql.dml import Insert as PostgreSQLInsert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.dialects.sqlite.dml import Insert as SQLiteInsert
from sqlmodel import Session, select

from ihub_server.models import (
    Capability,
    CapabilityCreate,
    CapabilityPublic,
    CapabilityUpdate,
    LifecycleMessage,
    Service,
)
from ihub_server.models.capability import CAPABILITY_SERVICE_NAME_CONSTRAINT

_SERVICE_NAME_COLUMNS = ("service_id", "name")


def _capability_public_statement():
    return (
        select(Capability, LifecycleMessage.last_updated)
        .join(Service, Service.id == Capability.service_id)
        .outerjoin(
            LifecycleMessage,
            and_(
                LifecycleMessage.broker_id == Capability.broker_id,
                LifecycleMessage.organization == Service.organization,
                LifecycleMessage.facility == Service.facility,
                LifecycleMessage.system == Service.system,
                LifecycleMessage.subsystem == Service.subsystem,
                LifecycleMessage.service == Service.name,
                LifecycleMessage.sdk_capability_name == Capability.name,
            ),
        )
    )


def _to_public(capability: Capability, last_updated: Any) -> CapabilityPublic:
    return CapabilityPublic.model_validate(
        capability,
        update={"lifecycle_last_updated": last_updated},
    )


def list_capabilities(session: Session, offset: int, limit: int) -> list[CapabilityPublic]:
    rows = session.exec(_capability_public_statement().offset(offset).limit(limit)).all()
    return [_to_public(capability, last_updated) for capability, last_updated in rows]


def list_capabilities_for_service(
    session: Session,
    service_id: int,
    offset: int,
    limit: int,
) -> list[CapabilityPublic]:
    statement = (
        _capability_public_statement()
        .where(Capability.service_id == service_id)
        .offset(offset)
        .limit(limit)
    )
    rows = session.exec(statement).all()
    return [_to_public(capability, last_updated) for capability, last_updated in rows]


def get_capability_with_health(
    session: Session,
    capability_id: int,
) -> CapabilityPublic | None:
    row = session.exec(_capability_public_statement().where(Capability.id == capability_id)).first()
    if row is None:
        return None
    capability, last_updated = row
    return _to_public(capability, last_updated)


def get_capability(session: Session, capability_id: int) -> Capability | None:
    return session.get(Capability, capability_id)


def create_capability(session: Session, capability: CapabilityCreate) -> Capability:
    db_capability = Capability.model_validate(capability)
    session.add(db_capability)
    session.commit()
    session.refresh(db_capability)
    return db_capability


def _build_postgresql_upsert(values: dict[str, Any]) -> PostgreSQLInsert:
    insert_statement = postgresql_insert(Capability).values(**values)
    return insert_statement.on_conflict_do_update(
        constraint=CAPABILITY_SERVICE_NAME_CONSTRAINT,
        set_={
            "broker_id": insert_statement.excluded.broker_id,
            "last_lifecycle_message": insert_statement.excluded.last_lifecycle_message,
            "endpoints_schema": insert_statement.excluded.endpoints_schema,
            "lifecycle_error": None,
            "lifecycle_error_at": None,
        },
    )


def _build_sqlite_upsert(values: dict[str, Any]) -> SQLiteInsert:
    insert_statement = sqlite_insert(Capability).values(**values)
    return insert_statement.on_conflict_do_update(
        index_elements=_SERVICE_NAME_COLUMNS,
        set_={
            "broker_id": insert_statement.excluded.broker_id,
            "last_lifecycle_message": insert_statement.excluded.last_lifecycle_message,
            "endpoints_schema": insert_statement.excluded.endpoints_schema,
            "lifecycle_error": None,
            "lifecycle_error_at": None,
        },
    )


def upsert_capability(
    session: Session,
    capability: CapabilityCreate,
    *,
    commit: bool = True,
) -> Capability:
    """Create or refresh a capability identified by service and name."""
    db_capability = Capability.model_validate(capability)
    values = db_capability.model_dump(exclude={"id"})
    dialect_name = session.get_bind().dialect.name

    if dialect_name == "postgresql":
        upsert_statement = _build_postgresql_upsert(values)
        db_capability = session.scalars(upsert_statement.returning(Capability)).one()
    elif dialect_name == "sqlite":
        sqlite_upsert_statement = _build_sqlite_upsert(values)
        db_capability = session.scalars(sqlite_upsert_statement.returning(Capability)).one()
    else:
        msg = f"Capability upsert does not support database dialect {dialect_name!r}"
        raise NotImplementedError(msg)

    if commit:
        session.commit()
        session.refresh(db_capability)
    else:
        session.flush()
    return db_capability


def update_capability(
    session: Session,
    capability: Capability,
    updates: CapabilityUpdate,
) -> Capability:
    capability_data = updates.model_dump(exclude_unset=True)
    capability.sqlmodel_update(capability_data)
    session.add(capability)
    session.commit()
    session.refresh(capability)
    return capability
