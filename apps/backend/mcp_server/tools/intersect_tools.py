import json
import logging
import os
from typing import Any
from urllib import error, request

logger = logging.getLogger(__name__)

_CAPABILITIES_PATH = '/api/v1/capabilities'
_SERVICES_PATH = '/api/v1/services'
_REQUEST_TIMEOUT_SECONDS = 10


def _read_required_env(name: str) -> str:
    value = os.getenv(name, '').strip()
    if not value:
        message = f'Missing required environment variable: {name}'
        raise RuntimeError(message)
    return value.split()[0]


def list_intersect_capabilities() -> list[dict[str, Any]]:
    """
    Retrieve the INTERSECT capabilities available from the iHub backend server.

    Returns:
        Decoded JSON capability objects from the backend capabilities endpoint.
    """
    return _list_backend_objects(
        path=_CAPABILITIES_PATH,
        resource_name='capabilities',
    )


def list_intersect_services() -> list[dict[str, Any]]:
    """
    Retrieve the INTERSECT services available from the iHub backend server.

    Returns:
        Decoded JSON service objects from the backend services endpoint.
    """
    return _list_backend_objects(
        path=_SERVICES_PATH,
        resource_name='services',
    )


def _list_backend_objects(
    *,
    path: str,
    resource_name: str,
) -> list[dict[str, Any]]:
    host = _read_required_env('IHUB_SERVER_HOST')
    port = _read_required_env('IHUB_SERVER_PORT')
    url = f'http://{host}:{port}{path}'

    logger.info('Fetching INTERSECT %s from %s', resource_name, url)

    backend_request = request.Request(
        url,
        headers={'Accept': 'application/json'},
        method='GET',
    )

    try:
        with request.urlopen(  # noqa: S310
            backend_request,
            timeout=_REQUEST_TIMEOUT_SECONDS,
        ) as response:
            payload = response.read().decode('utf-8')
    except error.HTTPError as exc:
        message = (
            f'{resource_name.capitalize()} request to {url} failed with HTTP status {exc.code}'
        )
        raise RuntimeError(message) from exc
    except error.URLError as exc:
        message = f'{resource_name.capitalize()} request to {url} failed: {exc.reason}'
        raise RuntimeError(message) from exc

    try:
        decoded_payload = json.loads(payload)
    except json.JSONDecodeError as exc:
        message = f'{resource_name.capitalize()} response from {url} was not valid JSON'
        raise RuntimeError(message) from exc

    if not isinstance(decoded_payload, list):
        message = f'{resource_name.capitalize()} response from {url} was not a JSON list'
        raise RuntimeError(message)  # noqa: TRY004

    return decoded_payload
