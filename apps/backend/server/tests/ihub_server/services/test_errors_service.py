from ihub_server.services.errors import (
    BrokerConnectionError,
    ConflictError,
    NotFoundError,
    ServiceError,
)


def test_error_hierarchy():
    assert issubclass(NotFoundError, ServiceError)
    assert issubclass(ConflictError, ServiceError)
    assert issubclass(BrokerConnectionError, ServiceError)
