import json
import unittest
from typing import Self
from unittest.mock import patch
from urllib import error

from tools.intersect_tools import list_intersect_services


class MockResponse:
    def __init__(self, payload: str) -> None:
        self._payload = payload

    def read(self) -> bytes:
        return self._payload.encode('utf-8')

    def __enter__(self) -> Self:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


class IntersectToolsTests(unittest.TestCase):
    @patch.dict(
        'os.environ',
        {'IHUB_SERVER_HOST': 'backend.example', 'IHUB_SERVER_PORT': '9000'},
        clear=True,
    )
    @patch('tools.intersect_tools.request.urlopen')
    def test_list_intersect_services_returns_decoded_payload(self, mock_urlopen) -> None:
        services = [{'name': 'svc-a'}, {'name': 'svc-b'}]
        mock_urlopen.return_value = MockResponse(json.dumps(services))

        result = list_intersect_services()

        assert result == services
        request_arg = mock_urlopen.call_args.args[0]
        assert request_arg.full_url == 'http://backend.example:9000/api/v1/services'
        assert request_arg.get_method() == 'GET'
        assert request_arg.headers['Accept'] == 'application/json'

    @patch.dict('os.environ', {}, clear=True)
    def test_list_intersect_services_requires_host_and_port(self) -> None:
        caught_error = None
        try:
            list_intersect_services()
        except RuntimeError as exc:
            caught_error = exc

        assert caught_error is not None
        assert str(caught_error) == 'Missing required environment variable: IHUB_SERVER_HOST'

    @patch.dict(
        'os.environ',
        {'IHUB_SERVER_HOST': 'backend.example', 'IHUB_SERVER_PORT': '9000'},
        clear=True,
    )
    @patch('tools.intersect_tools.request.urlopen')
    def test_list_intersect_services_surfaces_http_errors(self, mock_urlopen) -> None:
        mock_urlopen.side_effect = error.HTTPError(
            url='http://backend.example:9000/api/v1/services',
            code=503,
            msg='Service Unavailable',
            hdrs=None,
            fp=None,
        )

        caught_error = None
        try:
            list_intersect_services()
        except RuntimeError as exc:
            caught_error = exc

        assert caught_error is not None
        assert (
            str(caught_error)
            == 'Services request to http://backend.example:9000/api/v1/services failed with HTTP status 503'
        )

    @patch.dict(
        'os.environ',
        {'IHUB_SERVER_HOST': 'backend.example', 'IHUB_SERVER_PORT': '9000'},
        clear=True,
    )
    @patch('tools.intersect_tools.request.urlopen')
    def test_list_intersect_services_surfaces_invalid_json(self, mock_urlopen) -> None:
        mock_urlopen.return_value = MockResponse('not-json')

        caught_error = None
        try:
            list_intersect_services()
        except RuntimeError as exc:
            caught_error = exc

        assert caught_error is not None
        assert (
            str(caught_error)
            == 'Services response from http://backend.example:9000/api/v1/services was not valid JSON'
        )
