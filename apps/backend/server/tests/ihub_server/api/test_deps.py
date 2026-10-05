from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from ihub_server.api.deps import get_broker_connection_service, get_principal
from ihub_server.db import validate_user_session


def test_validate_user_session_accepts_and_normalizes_user():
    assert validate_user_session(
        {"role": "user", "subject_id": " subject ", "email": " USER@EXAMPLE.COM "}
    ) == {"role": "user", "subject_id": "subject", "email": "user@example.com"}


def test_get_principal_rejects_missing_session():
    with pytest.raises(HTTPException) as exc_info:
        get_principal(None)

    assert exc_info.value.status_code == 401


@pytest.mark.parametrize(
    "session",
    [
        {"role": "guest", "subject_id": "guest", "email": "guest@example.com"},
        {"role": "user", "subject_id": "", "email": "user@example.com"},
        {"role": "user", "subject_id": "subject", "email": ""},
        {"subject_id": "subject", "email": "user@example.com"},
    ],
)
def test_get_principal_rejects_invalid_or_non_user_session(session):
    with pytest.raises(HTTPException) as exc_info:
        get_principal(session)

    assert exc_info.value.status_code == 401


def test_broker_connection_service_uses_application_lifecycle_publisher():
    publisher = lambda _message: None
    connection = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(
                lifecycle_message_stream=SimpleNamespace(publish=publisher),
            )
        )
    )
    broker_service = object()

    service = get_broker_connection_service(connection, broker_service)

    assert service._broker_service is broker_service
    assert service._lifecycle_publisher is publisher
