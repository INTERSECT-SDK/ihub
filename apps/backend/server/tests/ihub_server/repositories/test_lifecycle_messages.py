from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

import pytest
from sqlmodel import Session, create_engine, select

from ihub_server.models import LifecycleMessage
from ihub_server.models.service import Hierarchy
from ihub_server.repositories import lifecycle_messages
from ihub_server.utils.lifecycle_message import ParsedBrokerMessage


@pytest.fixture
def session():
    engine = create_engine("sqlite://")
    LifecycleMessage.__table__.create(engine)
    with Session(engine) as database_session:
        yield database_session
    engine.dispose()


def _parsed_message(
    *,
    message_id: str,
    capability_name: str = "example-capability",
    broker_id: int = 1,
    created_at: datetime | None = None,
    organization: str = "original-org",
    facility: str = "original-facility",
    system: str = "original-system",
    subsystem: str = "original-subsystem",
    service: str = "original-service",
    endpoint_names: str = "original-endpoint",
) -> ParsedBrokerMessage:
    parsed = ParsedBrokerMessage(
        message_id=message_id,
        broker_id=broker_id,
        created_at=created_at or datetime(2026, 7, 10, tzinfo=UTC),
        hierarchy=Hierarchy(
            organization=organization,
            facility=facility,
            system=system,
            subsystem=subsystem,
            service=service,
        ),
    )
    parsed.sdk_capability_name = capability_name
    parsed.endpoint_names = endpoint_names
    parsed.endpoints_schema = {"endpoints": {endpoint_names: {}}}
    return parsed


def test_create_lifecycle_message_initializes_last_updated(session):
    created = lifecycle_messages.create_lifecycle_message(
        session,
        _parsed_message(message_id="message-1"),
    )

    assert created.id == 1
    assert created.message_id == "message-1"
    assert created.last_updated is not None
    assert session.exec(select(LifecycleMessage)).all() == [created]


def test_create_lifecycle_message_refreshes_message_fields_for_same_broker(session):
    original_created_at = datetime(2026, 7, 10, tzinfo=UTC)
    created = lifecycle_messages.create_lifecycle_message(
        session,
        _parsed_message(message_id="message-1", created_at=original_created_at),
    )
    original_id = created.id
    original_last_updated = created.last_updated

    updated = lifecycle_messages.create_lifecycle_message(
        session,
        _parsed_message(
            message_id="message-2",
            broker_id=1,
            created_at=original_created_at + timedelta(hours=1),
            endpoint_names="new-endpoint",
        ),
    )

    assert len(session.exec(select(LifecycleMessage)).all()) == 1
    assert updated.id == original_id
    assert updated.message_id == "message-2"
    assert updated.last_updated >= original_last_updated
    assert updated.broker_id == 1
    assert updated.created_at.replace(tzinfo=UTC) == original_created_at
    assert updated.organization == "original-org"
    assert updated.facility == "original-facility"
    assert updated.system == "original-system"
    assert updated.subsystem == "original-subsystem"
    assert updated.service == "original-service"
    assert updated.sdk_capability_name == "example-capability"
    assert updated.endpoint_names == "new-endpoint"


def test_same_context_for_different_brokers_creates_and_lists_separate_rows(session):
    first = lifecycle_messages.create_lifecycle_message(
        session,
        _parsed_message(message_id="broker-1-message", broker_id=1),
    )
    second = lifecycle_messages.create_lifecycle_message(
        session,
        _parsed_message(message_id="broker-2-message", broker_id=2),
    )

    assert first.id != second.id
    assert lifecycle_messages.list_lifecycle_messages(session, 1, 0, 10) == [first]
    assert lifecycle_messages.list_lifecycle_messages(session, 2, 0, 10) == [second]


def test_same_capability_name_in_different_system_or_service_creates_rows(session):
    first = lifecycle_messages.create_lifecycle_message(
        session,
        _parsed_message(message_id="message-1"),
    )
    other_system = lifecycle_messages.create_lifecycle_message(
        session,
        _parsed_message(message_id="message-2", system="other-system"),
    )
    other_service = lifecycle_messages.create_lifecycle_message(
        session,
        _parsed_message(message_id="message-3", service="other-service"),
    )

    rows = session.exec(select(LifecycleMessage)).all()
    assert len(rows) == 3
    assert {row.id for row in rows} == {first.id, other_system.id, other_service.id}


def test_same_context_in_different_subsystems_upserts_independently(session):
    first = lifecycle_messages.create_lifecycle_message(
        session,
        _parsed_message(message_id="subsystem-1-message", subsystem="subsystem-1"),
    )
    second = lifecycle_messages.create_lifecycle_message(
        session,
        _parsed_message(message_id="subsystem-2-message", subsystem="subsystem-2"),
    )

    updated = lifecycle_messages.create_lifecycle_message(
        session,
        _parsed_message(
            message_id="subsystem-1-update",
            subsystem="subsystem-1",
            endpoint_names="updated-endpoint",
        ),
    )

    rows = session.exec(select(LifecycleMessage)).all()
    assert len(rows) == 2
    assert updated.id == first.id
    assert updated.message_id == "subsystem-1-update"
    assert updated.endpoint_names == "updated-endpoint"
    assert second.id != first.id
    assert second.message_id == "subsystem-2-message"
    assert second.endpoint_names == "original-endpoint"


def test_concurrent_same_context_upserts_keep_one_consistent_publication(tmp_path):
    database_path = tmp_path / "lifecycle-concurrency.db"
    engine = create_engine(
        f"sqlite:///{database_path}",
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    LifecycleMessage.__table__.create(engine)
    barrier = Barrier(2)
    publications = (
        ("message-1", "endpoint-1"),
        ("message-2", "endpoint-2"),
    )

    def upsert(publication: tuple[str, str]) -> None:
        message_id, endpoint_names = publication
        with Session(engine) as concurrent_session:
            barrier.wait()
            lifecycle_messages.create_lifecycle_message(
                concurrent_session,
                _parsed_message(
                    message_id=message_id,
                    endpoint_names=endpoint_names,
                ),
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(upsert, publications))

    with Session(engine) as verification_session:
        rows = verification_session.exec(select(LifecycleMessage)).all()

    assert len(rows) == 1
    assert (rows[0].message_id, rows[0].endpoint_names) in publications
    engine.dispose()
