from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

import pytest
from sqlmodel import Session, create_engine, select

from ihub_server.models import Capability, CapabilityCreate, LifecycleMessage, Service
from ihub_server.repositories import capabilities


@pytest.fixture
def session():
    engine = create_engine("sqlite://")
    Capability.__table__.create(engine)
    with Session(engine) as database_session:
        yield database_session
    engine.dispose()


def _capability(
    *,
    service_id: int = 1,
    broker_id: int = 1,
    published_at: datetime | None = None,
    endpoint_name: str = "original-endpoint",
) -> CapabilityCreate:
    return CapabilityCreate(
        name="shared-capability",
        service_id=service_id,
        broker_id=broker_id,
        last_lifecycle_message=published_at or datetime(2026, 8, 24, tzinfo=UTC),
        endpoints_schema={"endpoints": {endpoint_name: {}}},
    )


def test_same_name_for_different_services_creates_independent_rows(session):
    first = capabilities.upsert_capability(session, _capability(service_id=1))
    second = capabilities.upsert_capability(session, _capability(service_id=2))

    rows = session.exec(select(Capability).order_by(Capability.service_id)).all()

    assert len(rows) == 2
    assert first.id != second.id
    assert [(row.service_id, row.name) for row in rows] == [
        (1, "shared-capability"),
        (2, "shared-capability"),
    ]


def test_repeat_upsert_refreshes_only_mutable_publication_fields(session):
    first_published_at = datetime(2026, 8, 24, 12, tzinfo=UTC)
    first = capabilities.upsert_capability(
        session,
        _capability(published_at=first_published_at),
    )
    first_id = first.id
    first_created_at = first.created_at

    second_published_at = first_published_at + timedelta(minutes=5)
    updated = capabilities.upsert_capability(
        session,
        _capability(
            broker_id=2,
            published_at=second_published_at,
            endpoint_name="updated-endpoint",
        ),
    )

    assert len(session.exec(select(Capability)).all()) == 1
    assert updated.id == first_id
    assert updated.service_id == 1
    assert updated.name == "shared-capability"
    assert updated.created_at == first_created_at
    assert updated.broker_id == 2
    assert updated.last_lifecycle_message.replace(tzinfo=UTC) == second_published_at
    assert updated.endpoints_schema == {"endpoints": {"updated-endpoint": {}}}


def test_upsert_for_one_service_does_not_refresh_same_name_for_another(session):
    other_published_at = datetime(2026, 8, 24, 11, tzinfo=UTC)
    other = capabilities.upsert_capability(
        session,
        _capability(service_id=2, broker_id=3, published_at=other_published_at),
    )

    capabilities.upsert_capability(
        session,
        _capability(service_id=1, broker_id=4, endpoint_name="updated-endpoint"),
    )

    preserved = session.get(Capability, other.id)
    assert preserved is not None
    assert preserved.broker_id == 3
    assert preserved.last_lifecycle_message.replace(tzinfo=UTC) == other_published_at
    assert preserved.endpoints_schema == {"endpoints": {"original-endpoint": {}}}


def test_capability_reads_join_exact_lifecycle_context():
    engine = create_engine("sqlite://")
    Service.__table__.create(engine)
    Capability.__table__.create(engine)
    LifecycleMessage.__table__.create(engine)
    received_at = datetime(2026, 9, 26, 12, tzinfo=UTC)

    with Session(engine) as session:
        service = Service(
            name="service",
            broker_id=1,
            organization="org",
            facility="facility",
            system="system",
            subsystem="subsystem",
        )
        session.add(service)
        session.commit()
        session.refresh(service)
        capability = capabilities.upsert_capability(
            session,
            _capability(service_id=service.id, broker_id=1),
        )
        capabilities.upsert_capability(
            session,
            CapabilityCreate(
                name="without-lifecycle-row",
                service_id=service.id,
                broker_id=1,
                endpoints_schema={"endpoints": {}},
            ),
        )
        session.add(
            LifecycleMessage(
                message_id="matching",
                broker_id=1,
                organization="org",
                facility="facility",
                system="system",
                subsystem="subsystem",
                service="service",
                sdk_capability_name="shared-capability",
                endpoint_names="endpoint",
                last_updated=received_at,
            )
        )
        session.add(
            LifecycleMessage(
                message_id="other-broker",
                broker_id=2,
                organization="org",
                facility="facility",
                system="system",
                subsystem="subsystem",
                service="service",
                sdk_capability_name="shared-capability",
                endpoint_names="endpoint",
                last_updated=received_at + timedelta(hours=1),
            )
        )
        session.commit()

        public = capabilities.get_capability_with_health(session, capability.id)
        public_rows = capabilities.list_capabilities(session, 0, 100)

    assert public is not None
    assert public.lifecycle_last_updated.replace(tzinfo=UTC) == received_at
    unmatched = next(row for row in public_rows if row.name == "without-lifecycle-row")
    assert unmatched.lifecycle_last_updated is None
    engine.dispose()


def test_concurrent_upserts_for_same_service_and_name_keep_one_row(tmp_path):
    database_path = tmp_path / "capability-concurrency.db"
    engine = create_engine(
        f"sqlite:///{database_path}",
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    Capability.__table__.create(engine)
    barrier = Barrier(2)
    publications = (
        (1, "endpoint-1"),
        (2, "endpoint-2"),
    )

    def upsert(publication: tuple[int, str]) -> None:
        broker_id, endpoint_name = publication
        with Session(engine) as concurrent_session:
            barrier.wait()
            capabilities.upsert_capability(
                concurrent_session,
                _capability(broker_id=broker_id, endpoint_name=endpoint_name),
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(upsert, publications))

    with Session(engine) as verification_session:
        rows = verification_session.exec(select(Capability)).all()

    assert len(rows) == 1
    stored_publication = (
        rows[0].broker_id,
        next(iter(rows[0].endpoints_schema["endpoints"])),
    )
    assert stored_publication in publications
    engine.dispose()
