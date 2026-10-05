"""Service that validates health of the intersect client connection."""

from ihub_server.services.errors import ServiceError


class HealthcheckService:
    def check(self, app_state) -> list[str]:
        if not hasattr(app_state, "intersect_client"):
            msg = "Intersect client not initialized"
            raise ServiceError(msg)

        errors: list[str] = []
        client = app_state.intersect_client
        if not client.is_connected():
            errors.append("not connected")
        return errors
