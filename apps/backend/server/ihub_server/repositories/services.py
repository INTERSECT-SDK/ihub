"""Repository helpers for Service CRUD and broker-scoped listings."""

from typing import cast

from sqlmodel import Session, select

from ihub_server.models import Service, ServiceCreate, ServiceUpdate


def list_services(session: Session, offset: int, limit: int) -> list[Service]:
    return cast(list[Service], session.exec(select(Service).offset(offset).limit(limit)).all())


def list_services_for_broker(session: Session, broker_id: int) -> list[Service]:
    return cast(
        list[Service],
        session.exec(select(Service).where(Service.broker_id == broker_id)).all(),
    )


def get_service(session: Session, service_id: int) -> Service | None:
    return session.get(Service, service_id)


def get_service_by_name(session: Session, service_name: str) -> Service | None:
    return session.exec(select(Service).where(Service.name == service_name)).first()


def create_service(
    session: Session,
    service: ServiceCreate,
    *,
    commit: bool = True,
) -> Service:
    db_service = Service.model_validate(service)
    session.add(db_service)
    if commit:
        session.commit()
        session.refresh(db_service)
    else:
        session.flush()
    return db_service


def update_service(
    session: Session,
    service: Service,
    updates: ServiceUpdate,
    *,
    commit: bool = True,
) -> Service:
    service_data = updates.model_dump(exclude_unset=True)
    service.sqlmodel_update(service_data)
    session.add(service)
    if commit:
        session.commit()
        session.refresh(service)
    else:
        session.flush()
    return service
