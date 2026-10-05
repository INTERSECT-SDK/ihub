"""Service-layer exception types used across business logic."""


class ServiceError(Exception):
    """Base class for service-layer errors."""


class BadRequestError(ServiceError):
    """Raised when a request is invalid."""


class UnsupportedCampaignFormatError(ServiceError):
    """Raised when a retired or mixed campaign document is submitted."""


class NotFoundError(ServiceError):
    """Raised when a requested entity is missing."""


class UnauthorizedError(ServiceError):
    """Raised when authentication fails."""


class ConflictError(ServiceError):
    """Raised when a request conflicts with current state."""


class ForbiddenError(ServiceError):
    """Raised when the principal is not allowed to perform an action."""


class BrokerConnectionError(ServiceError):
    """Raised when an external connection cannot be established."""


class UpstreamServiceError(ServiceError):
    """Raised when an upstream service request fails."""

    def __init__(self, message: str, *, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code
