"""Repository helpers for Broker CRUD operations."""

from typing import cast
from uuid import UUID

from sqlmodel import Session, or_, select

from ihub_server.models import Broker, BrokerCreate, BrokerUpdate


def list_brokers(
    session: Session, offset: int, limit: int, project_id: UUID | None = None
) -> list[Broker]:
    statement = select(Broker)
    if project_id is not None:
        statement = statement.where(
            or_(Broker.project_id == project_id, Broker.project_id.is_(None))  # type: ignore[union-attr]
        )
    return cast(list[Broker], session.exec(statement.offset(offset).limit(limit)).all())


def get_broker(session: Session, broker_id: int) -> Broker | None:
    return session.get(Broker, broker_id)


def create_broker(session: Session, broker: BrokerCreate) -> Broker:
    db_broker = Broker.model_validate(broker)
    session.add(db_broker)
    session.commit()
    session.refresh(db_broker)
    return db_broker


def update_broker(session: Session, broker: Broker, updates: BrokerUpdate) -> Broker:
    broker_data = updates.model_dump(exclude_unset=True)
    broker.sqlmodel_update(broker_data)
    session.add(broker)
    session.commit()
    session.refresh(broker)
    return broker


def delete_broker(session: Session, broker: Broker) -> None:
    session.delete(broker)
    session.commit()
