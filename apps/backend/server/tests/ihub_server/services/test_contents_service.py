import asyncio
import json
from unittest.mock import AsyncMock, call

import httpx
import pytest

from ihub_server.services import contents as contents_module
from ihub_server.services.contents import ContentService
from ihub_server.services.errors import (
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    UnauthorizedError,
    UpstreamServiceError,
)


class FakeResponse:
    def __init__(self, body=None, status_code=200):
        self._body = body if body is not None else {}
        self.status_code = status_code
        self.content = b"" if body is None else b"{}"

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            request = httpx.Request("GET", "http://testserver")
            raise httpx.HTTPStatusError(
                "error",
                request=request,
                response=self,
            )


class FakeAsyncClient:
    def __init__(self, response):
        self._response = response
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def request(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return self._response


def test_build_contents_url_encodes_jupyter_user_and_path():
    service = ContentService()

    result = service.build_contents_url(
        "http://testserver/ijupyterhub",
        "user+one@example.com",
        "projects/project 123/demo.ipynb",
    )

    assert result == (
        "http://testserver/ijupyterhub/user/"
        "user%2Bone@example.com/api/contents/projects/project%20123/demo.ipynb"
    )


def test_build_contents_url_supports_direct_jupyterhub_base_url():
    service = ContentService()

    result = service.build_contents_url(
        "http://jupyterhub:8000",
        "user@example.com",
        "projects/project/demo.ipynb",
    )

    assert result == (
        "http://jupyterhub:8000/user/user@example.com/api/contents/projects/project/demo.ipynb"
    )


def test_build_contents_url_expects_decoded_jupyter_user():
    service = ContentService()

    decoded_result = service.build_contents_url(
        "http://testserver/ijupyterhub",
        "user@example.com",
        "projects/project/demo.ipynb",
    )
    encoded_result = service.build_contents_url(
        "http://testserver/ijupyterhub",
        "user%40example.com",
        "projects/project/demo.ipynb",
    )

    assert decoded_result == (
        "http://testserver/ijupyterhub/user/"
        "user@example.com/api/contents/projects/project/demo.ipynb"
    )
    assert encoded_result == (
        "http://testserver/ijupyterhub/user/"
        "user%2540example.com/api/contents/projects/project/demo.ipynb"
    )


def test_build_contents_url_supports_user_server_base_url():
    service = ContentService()

    encoded_result = service.build_contents_url(
        "http://testserver/ijupyterhub/user/user%40example.com",
        "user@example.com",
        "projects/project/demo.ipynb",
    )
    raw_result = service.build_contents_url(
        "http://testserver/ijupyterhub/user/user@example.com",
        "user@example.com",
        "projects/project/demo.ipynb",
    )

    assert encoded_result == (
        "http://testserver/ijupyterhub/user/"
        "user@example.com/api/contents/projects/project/demo.ipynb"
    )
    assert raw_result == (
        "http://testserver/ijupyterhub/user/"
        "user@example.com/api/contents/projects/project/demo.ipynb"
    )


def test_build_contents_url_supports_named_user_server_base_url():
    service = ContentService()

    result = service.build_contents_url(
        "http://testserver/ijupyterhub/user/user%40example.com/lab-server",
        "user@example.com",
        "projects/project/demo.ipynb",
    )

    assert result == (
        "http://testserver/ijupyterhub/user/"
        "user@example.com/lab-server/api/contents/projects/project/demo.ipynb"
    )


@pytest.mark.parametrize(
    ("base_url", "expected_url"),
    [
        (
            "http://testserver/ijupyterhub",
            "http://testserver/ijupyterhub/user/user@example.com/"
            "files/projects/project%20123/%E6%95%B0%E6%8D%AE.bin",
        ),
        (
            "http://testserver/ijupyterhub/user/user%40example.com/lab-server",
            "http://testserver/ijupyterhub/user/user@example.com/lab-server/"
            "files/projects/project%20123/%E6%95%B0%E6%8D%AE.bin",
        ),
    ],
)
def test_build_files_url_supports_hub_and_user_server_bases(base_url, expected_url):
    service = ContentService()

    result = service.build_files_url(
        base_url,
        "user@example.com",
        "projects/project 123/数据.bin",
    )

    assert result == expected_url


@pytest.mark.parametrize(
    "path",
    [
        "/projects/project/demo.ipynb",
        "../api/status",
        "../../api/status",
        "projects/../demo.ipynb",
        "projects/./demo.ipynb",
    ],
)
def test_build_contents_url_rejects_unsafe_paths(path):
    service = ContentService()

    with pytest.raises(BadRequestError, match="Invalid contents path"):
        service.build_contents_url(
            "http://testserver/ijupyterhub",
            "user@example.com",
            path,
        )


def test_read_content_sends_bearer_token_and_query(monkeypatch):
    response_model = {"path": "projects/project-123/demo.ipynb", "content": []}
    fake_client = FakeAsyncClient(FakeResponse(response_model))
    monkeypatch.setattr(
        contents_module.httpx,
        "AsyncClient",
        lambda: fake_client,
    )
    service = ContentService()

    result = asyncio.run(
        service.read_content(
            "http://testserver/ijupyterhub",
            "projects/project-123/demo.ipynb",
            "user@example.com",
            "secret-token",
            query={"type": "notebook", "content": "0"},
        )
    )

    assert result == response_model
    assert fake_client.calls == [
        (
            (
                "GET",
                "http://testserver/ijupyterhub/user/user@example.com/api/contents/projects/project-123/demo.ipynb",
            ),
            {
                "headers": {"Authorization": "Bearer secret-token"},
                "params": {"type": "notebook", "content": "0"},
                "json": None,
            },
        )
    ]


def test_save_content_forwards_jupyter_payload(monkeypatch):
    payload = {
        "type": "file",
        "format": "text",
        "content": '{"enabled": true}',
    }
    fake_client = FakeAsyncClient(FakeResponse({"path": "projects/project/config.json"}))
    monkeypatch.setattr(
        contents_module.httpx,
        "AsyncClient",
        lambda: fake_client,
    )
    service = ContentService()

    result = asyncio.run(
        service.save_content(
            "http://testserver/ijupyterhub",
            "projects/project/config.json",
            payload,
            "user@example.com",
            "secret-token",
        )
    )

    assert result == {"path": "projects/project/config.json"}
    assert fake_client.calls[0][0] == (
        "PUT",
        "http://testserver/ijupyterhub/user/user@example.com/api/contents/projects/project/config.json",
    )
    assert fake_client.calls[0][1]["headers"] == {"Authorization": "Bearer secret-token"}
    assert fake_client.calls[0][1]["json"] == payload


def test_rename_content_forwards_patch_and_destination_path(monkeypatch):
    response_model = {
        "name": "renamed file.json",
        "path": "projects/project/nested/renamed file.json",
    }
    fake_client = FakeAsyncClient(FakeResponse(response_model))
    monkeypatch.setattr(
        contents_module.httpx,
        "AsyncClient",
        lambda: fake_client,
    )
    service = ContentService()
    read_content = AsyncMock(return_value={"type": "file", "writable": True})
    monkeypatch.setattr(service, "read_content", read_content)

    result = asyncio.run(
        service.rename_content(
            "http://testserver/ijupyterhub",
            "projects/project/nested/original file.json",
            "projects/project/nested/renamed file.json",
            "user@example.com",
            "secret-token",
        )
    )

    assert result == response_model
    read_content.assert_awaited_once_with(
        "http://testserver/ijupyterhub",
        "projects/project/nested/original file.json",
        "user@example.com",
        "secret-token",
        query={"content": "0"},
    )
    assert fake_client.calls == [
        (
            (
                "PATCH",
                "http://testserver/ijupyterhub/user/user@example.com/api/contents/"
                "projects/project/nested/original%20file.json",
            ),
            {
                "headers": {"Authorization": "Bearer secret-token"},
                "params": None,
                "json": {"path": "projects/project/nested/renamed file.json"},
            },
        )
    ]


def test_build_renamed_ichat_content_updates_only_chat_name():
    service = ContentService()
    chat_data = {
        "chatId": "chat-1",
        "chatName": "original.ichat",
        "participants": [{"userId": "user-1", "userName": "Zoë"}],
        "messages": [{"id": "message-1", "content": "Καλημέρα"}],
        "createdAt": "2026-07-29T12:00:00Z",
        "unknown": {"preserved": True},
    }
    source_content = {
        "type": "file",
        "format": "text",
        "content": json.dumps(chat_data),
    }

    result = service._build_renamed_ichat_content(
        source_content,
        "renamed δ.ichat",
    )

    renamed_chat = json.loads(result["content"])
    assert result["type"] == "file"
    assert result["format"] == "text"
    assert renamed_chat["chatName"] == "renamed δ.ichat"
    assert {key: value for key, value in renamed_chat.items() if key != "chatName"} == {
        key: value for key, value in chat_data.items() if key != "chatName"
    }
    assert "Καλημέρα" in result["content"]


@pytest.mark.parametrize(
    "source_content",
    [
        {"type": "file", "format": "base64", "content": "e30="},
        {"type": "file", "format": "text", "content": "not-json"},
        {"type": "file", "format": "text", "content": "[]"},
        {
            "type": "file",
            "format": "text",
            "content": '{"chatName":"incomplete.ichat","participants":[]}',
        },
        {
            "type": "file",
            "format": "text",
            "content": '{"chatName":42,"participants":[],"messages":[]}',
        },
    ],
)
def test_build_renamed_ichat_content_rejects_unsupported_documents(source_content):
    service = ContentService()

    with pytest.raises(BadRequestError, match="chat file"):
        service._build_renamed_ichat_content(source_content, "renamed.ichat")


def test_rename_ichat_reads_renames_and_saves_updated_chat(monkeypatch):
    service = ContentService()
    source_content = {
        "type": "file",
        "format": "text",
        "content": json.dumps(
            {
                "chatId": "chat-1",
                "chatName": "original.ichat",
                "participants": [],
                "messages": [],
                "unknown": "preserved",
            }
        ),
    }
    renamed_model = {
        "name": "renamed δ.ichat",
        "path": "projects/project/renamed δ.ichat",
    }
    read_content = AsyncMock(
        side_effect=[
            {"type": "file", "writable": True},
            source_content,
        ]
    )
    rename_resource = AsyncMock(return_value=renamed_model)
    save_content = AsyncMock(return_value=renamed_model)
    monkeypatch.setattr(service, "read_content", read_content)
    monkeypatch.setattr(service, "_rename_contents_resource", rename_resource)
    monkeypatch.setattr(service, "save_content", save_content)

    result = asyncio.run(
        service.rename_content(
            "http://testserver/ijupyterhub",
            "projects/project/original.ichat",
            "projects/project/renamed δ.ichat",
            "user@example.com",
            "secret-token",
        )
    )

    assert result == renamed_model
    assert read_content.await_args_list == [
        call(
            "http://testserver/ijupyterhub",
            "projects/project/original.ichat",
            "user@example.com",
            "secret-token",
            query={"content": "0"},
        ),
        call(
            "http://testserver/ijupyterhub",
            "projects/project/original.ichat",
            "user@example.com",
            "secret-token",
        ),
    ]
    rename_resource.assert_awaited_once_with(
        "http://testserver/ijupyterhub",
        "projects/project/original.ichat",
        "projects/project/renamed δ.ichat",
        "user@example.com",
        "secret-token",
    )
    saved_chat = json.loads(save_content.await_args.args[2]["content"])
    assert saved_chat == {
        "chatId": "chat-1",
        "chatName": "renamed δ.ichat",
        "participants": [],
        "messages": [],
        "unknown": "preserved",
    }


def test_rename_ichat_rejects_invalid_content_before_rename(monkeypatch):
    service = ContentService()
    read_content = AsyncMock(
        side_effect=[
            {"type": "file", "writable": True},
            {
                "type": "file",
                "format": "text",
                "content": '{"chatName":"original.ichat","participants":[]}',
            },
        ]
    )
    rename_resource = AsyncMock()
    monkeypatch.setattr(service, "read_content", read_content)
    monkeypatch.setattr(service, "_rename_contents_resource", rename_resource)

    with pytest.raises(BadRequestError, match="supported chat document"):
        asyncio.run(
            service.rename_content(
                "http://testserver/ijupyterhub",
                "projects/project/original.ichat",
                "projects/project/renamed.ichat",
                "user@example.com",
                "secret-token",
            )
        )

    rename_resource.assert_not_awaited()


def test_rename_ichat_conflict_does_not_save_chat(monkeypatch):
    service = ContentService()
    source_content = {
        "type": "file",
        "format": "text",
        "content": '{"chatName":"original.ichat","participants":[],"messages":[]}',
    }
    save_content = AsyncMock()
    monkeypatch.setattr(service, "read_content", AsyncMock(return_value=source_content))
    monkeypatch.setattr(
        service,
        "_rename_contents_resource",
        AsyncMock(side_effect=ConflictError("A file with this name already exists.")),
    )
    monkeypatch.setattr(service, "save_content", save_content)

    with pytest.raises(ConflictError, match="already exists"):
        asyncio.run(
            service.rename_content(
                "http://testserver/ijupyterhub",
                "projects/project/original.ichat",
                "projects/project/renamed.ichat",
                "user@example.com",
                "secret-token",
            )
        )

    save_content.assert_not_awaited()


def test_rename_ichat_rolls_back_path_when_name_save_fails(monkeypatch):
    service = ContentService()
    source_content = {
        "type": "file",
        "format": "text",
        "content": '{"chatName":"original.ichat","participants":[],"messages":[]}',
    }
    rename_resource = AsyncMock(
        side_effect=[
            {"path": "projects/project/renamed.ichat"},
            {"path": "projects/project/original.ichat"},
        ]
    )
    monkeypatch.setattr(service, "read_content", AsyncMock(return_value=source_content))
    monkeypatch.setattr(service, "_rename_contents_resource", rename_resource)
    monkeypatch.setattr(
        service,
        "save_content",
        AsyncMock(side_effect=UpstreamServiceError("Chat save failed.")),
    )

    with pytest.raises(UpstreamServiceError, match="Chat save failed"):
        asyncio.run(
            service.rename_content(
                "http://testserver/ijupyterhub",
                "projects/project/original.ichat",
                "projects/project/renamed.ichat",
                "user@example.com",
                "secret-token",
            )
        )

    assert [call.args[1:3] for call in rename_resource.await_args_list] == [
        ("projects/project/original.ichat", "projects/project/renamed.ichat"),
        ("projects/project/renamed.ichat", "projects/project/original.ichat"),
    ]


def test_rename_ichat_reports_partial_failure_when_rollback_fails(monkeypatch):
    service = ContentService()
    source_content = {
        "type": "file",
        "format": "text",
        "content": '{"chatName":"original.ichat","participants":[],"messages":[]}',
    }
    monkeypatch.setattr(service, "read_content", AsyncMock(return_value=source_content))
    monkeypatch.setattr(
        service,
        "_rename_contents_resource",
        AsyncMock(
            side_effect=[
                {"path": "projects/project/renamed.ichat"},
                UpstreamServiceError("Rollback failed."),
            ]
        ),
    )
    monkeypatch.setattr(
        service,
        "save_content",
        AsyncMock(side_effect=UpstreamServiceError("Chat save failed.")),
    )

    with pytest.raises(
        UpstreamServiceError,
        match="Chat file was renamed, but its embedded name could not be updated",
    ):
        asyncio.run(
            service.rename_content(
                "http://testserver/ijupyterhub",
                "projects/project/original.ichat",
                "projects/project/renamed.ichat",
                "user@example.com",
                "secret-token",
            )
        )


def test_rename_icmp_changes_only_path_and_does_not_rewrite_content(monkeypatch):
    service = ContentService()
    source_content = {
        "type": "file",
        "format": "text",
        "content": json.dumps(
            {
                "campaignName": "original.icmp",
                "nodes": [],
                "edges": [],
                "unknown": "preserved",
            }
        ),
    }
    renamed_model = {
        "name": "renamed δ.icmp",
        "path": "projects/project/renamed δ.icmp",
    }
    read_content = AsyncMock(return_value=source_content)
    rename_resource = AsyncMock(return_value=renamed_model)
    save_content = AsyncMock(return_value=renamed_model)
    monkeypatch.setattr(service, "read_content", read_content)
    monkeypatch.setattr(service, "_rename_contents_resource", rename_resource)
    monkeypatch.setattr(service, "save_content", save_content)

    result = asyncio.run(
        service.rename_content(
            "http://testserver/ijupyterhub",
            "projects/project/original.icmp",
            "projects/project/renamed δ.icmp",
            "user@example.com",
            "secret-token",
        )
    )

    assert result == renamed_model
    read_content.assert_awaited_once_with(
        "http://testserver/ijupyterhub",
        "projects/project/original.icmp",
        "user@example.com",
        "secret-token",
        query={"content": "0"},
    )
    rename_resource.assert_awaited_once_with(
        "http://testserver/ijupyterhub",
        "projects/project/original.icmp",
        "projects/project/renamed δ.icmp",
        "user@example.com",
        "secret-token",
    )
    save_content.assert_not_awaited()


def test_rename_icmp_does_not_parse_or_rewrite_invalid_content(monkeypatch):
    service = ContentService()
    monkeypatch.setattr(
        service,
        "read_content",
        AsyncMock(
            return_value={
                "type": "file",
                "format": "text",
                "content": "not-json",
            }
        ),
    )
    rename_resource = AsyncMock()
    monkeypatch.setattr(service, "_rename_contents_resource", rename_resource)

    asyncio.run(
        service.rename_content(
            "http://testserver/ijupyterhub",
            "projects/project/original.icmp",
            "projects/project/renamed.icmp",
            "user@example.com",
            "secret-token",
        )
    )

    rename_resource.assert_awaited_once()


@pytest.mark.parametrize(
    ("source_content", "error_type", "message"),
    [
        ({"type": "directory", "writable": True}, BadRequestError, "Only project files"),
        ({"type": "file", "writable": False}, ForbiddenError, "not writable"),
    ],
)
def test_rename_rejects_directories_and_read_only_files(
    monkeypatch,
    source_content,
    error_type,
    message,
):
    service = ContentService()
    monkeypatch.setattr(
        service,
        "read_content",
        AsyncMock(return_value=source_content),
    )
    rename_resource = AsyncMock()
    monkeypatch.setattr(service, "_rename_contents_resource", rename_resource)

    with pytest.raises(error_type, match=message):
        asyncio.run(
            service.rename_content(
                "http://testserver/ijupyterhub",
                "projects/project/original.json",
                "projects/project/renamed.json",
                "user@example.com",
                "secret-token",
            )
        )

    rename_resource.assert_not_awaited()


def test_rename_icmp_conflict_does_not_save_campaign(monkeypatch):
    service = ContentService()
    source_content = {
        "type": "file",
        "format": "text",
        "content": '{"campaignName":"original.icmp","nodes":[],"edges":[]}',
    }
    save_content = AsyncMock()
    monkeypatch.setattr(service, "read_content", AsyncMock(return_value=source_content))
    monkeypatch.setattr(
        service,
        "_rename_contents_resource",
        AsyncMock(side_effect=ConflictError("A file with this name already exists.")),
    )
    monkeypatch.setattr(service, "save_content", save_content)

    with pytest.raises(ConflictError, match="already exists"):
        asyncio.run(
            service.rename_content(
                "http://testserver/ijupyterhub",
                "projects/project/original.icmp",
                "projects/project/renamed.icmp",
                "user@example.com",
                "secret-token",
            )
        )

    save_content.assert_not_awaited()


@pytest.mark.parametrize(
    "method_name",
    ["read_content", "save_content", "delete_content", "rename_content", "stream_file"],
)
def test_contents_operations_reject_traversal_before_request(
    monkeypatch,
    method_name,
):
    def fail_async_client():
        raise AssertionError("upstream request should not be attempted")

    monkeypatch.setattr(contents_module.httpx, "AsyncClient", fail_async_client)
    service = ContentService()
    method = getattr(service, method_name)

    with pytest.raises(BadRequestError, match="Invalid contents path"):
        if method_name == "save_content":
            asyncio.run(
                method(
                    "http://testserver/ijupyterhub",
                    "../../api/status",
                    {"type": "file", "content": "demo", "format": "text"},
                    "user@example.com",
                    "secret-token",
                )
            )
        elif method_name == "rename_content":
            asyncio.run(
                method(
                    "http://testserver/ijupyterhub",
                    "projects/project/demo.json",
                    "../../api/status.json",
                    "user@example.com",
                    "secret-token",
                )
            )
        else:
            asyncio.run(
                method(
                    "http://testserver/ijupyterhub",
                    "../../api/status",
                    "user@example.com",
                    "secret-token",
                )
            )


def test_rename_content_maps_upstream_conflict(monkeypatch):
    fake_client = FakeAsyncClient(FakeResponse(status_code=409))
    monkeypatch.setattr(
        contents_module.httpx,
        "AsyncClient",
        lambda: fake_client,
    )
    service = ContentService()
    monkeypatch.setattr(
        service,
        "read_content",
        AsyncMock(return_value={"type": "file", "writable": True}),
    )

    with pytest.raises(ConflictError, match="A file with this name already exists"):
        asyncio.run(
            service.rename_content(
                "http://testserver/ijupyterhub",
                "projects/project/original.json",
                "projects/project/renamed.json",
                "user@example.com",
                "secret-token",
            )
        )


def test_stream_file_preserves_raw_chunks_metadata_and_credentials(monkeypatch):
    class FakeStreamingResponse:
        status_code = 200
        headers = {
            "Content-Type": "application/x-custom",
            "Content-Length": "5",
        }

        def __init__(self):
            self.closed = False

        def raise_for_status(self):
            return None

        async def aiter_raw(self):
            yield b"\x00\xff"
            yield b"raw"

        async def aclose(self):
            self.closed = True

    class FakeStreamingClient:
        def __init__(self, response):
            self.response = response
            self.calls = []
            self.closed = False

        def build_request(self, method, url, *, headers):
            self.calls.append(("build", method, url, headers))
            return httpx.Request(method, url, headers=headers)

        async def send(self, request, *, stream):
            self.calls.append(("send", request, stream))
            return self.response

        async def aclose(self):
            self.closed = True

    response = FakeStreamingResponse()
    client = FakeStreamingClient(response)
    captured_timeout = None

    def create_streaming_client(*, timeout):
        nonlocal captured_timeout
        captured_timeout = timeout
        return client

    monkeypatch.setattr(
        contents_module.httpx,
        "AsyncClient",
        create_streaming_client,
    )
    service = ContentService()

    async def consume_stream():
        stream = await service.stream_file(
            "http://testserver/ijupyterhub",
            "projects/project 123/data.bin",
            "user@example.com",
            "secret-token",
        )
        chunks = [chunk async for chunk in stream.iter_raw()]
        return stream, chunks

    stream, chunks = asyncio.run(consume_stream())

    assert chunks == [b"\x00\xff", b"raw"]
    assert stream.content_type == "application/x-custom"
    assert stream.content_length == "5"
    assert client.calls[0] == (
        "build",
        "GET",
        "http://testserver/ijupyterhub/user/user@example.com/files/projects/project%20123/data.bin",
        {
            "Accept-Encoding": "identity",
            "Authorization": "Bearer secret-token",
        },
    )
    assert client.calls[1][0] == "send"
    assert client.calls[1][2] is True
    assert captured_timeout is not None
    assert captured_timeout.connect == 5.0
    assert captured_timeout.read is None
    assert captured_timeout.write == 5.0
    assert captured_timeout.pool == 5.0
    assert response.closed is True
    assert client.closed is True


@pytest.mark.parametrize(
    ("status_code", "error_type"),
    [
        (400, BadRequestError),
        (401, UnauthorizedError),
        (403, ForbiddenError),
        (404, NotFoundError),
        (502, UpstreamServiceError),
    ],
)
def test_stream_file_translates_status_and_closes_resources(
    monkeypatch,
    status_code,
    error_type,
):
    class FailingResponse:
        headers = {}

        def __init__(self):
            self.status_code = status_code
            self.closed = False

        def raise_for_status(self):
            raise httpx.HTTPStatusError(
                "failed",
                request=httpx.Request("GET", "http://testserver/file"),
                response=self,
            )

        async def aclose(self):
            self.closed = True

    class FailingClient:
        def __init__(self, response):
            self.response = response
            self.closed = False

        def build_request(self, method, url, *, headers):
            return httpx.Request(method, url, headers=headers)

        async def send(self, _request, *, stream):
            assert stream is True
            return self.response

        async def aclose(self):
            self.closed = True

    response = FailingResponse()
    client = FailingClient(response)
    monkeypatch.setattr(
        contents_module.httpx,
        "AsyncClient",
        lambda **_kwargs: client,
    )

    with pytest.raises(error_type):
        asyncio.run(
            ContentService().stream_file(
                "http://testserver/ijupyterhub",
                "projects/project/file.bin",
                "user@example.com",
                "token",
            )
        )

    assert response.closed is True
    assert client.closed is True


def test_stream_file_translates_transport_failure_and_closes_client(monkeypatch):
    class FailingClient:
        def __init__(self):
            self.closed = False

        def build_request(self, method, url, *, headers):
            return httpx.Request(method, url, headers=headers)

        async def send(self, request, *, stream):
            assert stream is True
            raise httpx.ConnectError("unreachable", request=request)

        async def aclose(self):
            self.closed = True

    client = FailingClient()
    monkeypatch.setattr(
        contents_module.httpx,
        "AsyncClient",
        lambda **_kwargs: client,
    )

    with pytest.raises(UpstreamServiceError, match="upstream Jupyter"):
        asyncio.run(
            ContentService().stream_file(
                "http://testserver/ijupyterhub",
                "projects/project/file.bin",
                "user@example.com",
                "token",
            )
        )

    assert client.closed is True


def test_delete_content_returns_upstream_json(monkeypatch):
    fake_client = FakeAsyncClient(FakeResponse({"message": "deleted"}))
    monkeypatch.setattr(
        contents_module.httpx,
        "AsyncClient",
        lambda: fake_client,
    )
    service = ContentService()

    result = asyncio.run(
        service.delete_content(
            "http://testserver/ijupyterhub",
            "projects/project/demo.ipynb",
            "user@example.com",
            "secret-token",
        )
    )

    assert result == {"message": "deleted"}
    assert fake_client.calls[0][0][0] == "DELETE"


def test_delete_content_returns_empty_model_for_204_no_content(monkeypatch):
    fake_client = FakeAsyncClient(FakeResponse(status_code=204))
    monkeypatch.setattr(
        contents_module.httpx,
        "AsyncClient",
        lambda: fake_client,
    )
    service = ContentService()

    result = asyncio.run(
        service.delete_content(
            "http://testserver/ijupyterhub",
            "projects/project/demo.ipynb",
            "user@example.com",
            "secret-token",
        )
    )

    assert result == {}
    assert fake_client.calls[0][0][0] == "DELETE"


def test_get_files_returns_upstream_directory_model(monkeypatch):
    directory_model = {
        "type": "directory",
        "content": [{"name": "demo.ipynb"}],
    }
    fake_client = FakeAsyncClient(FakeResponse(directory_model))
    monkeypatch.setattr(
        contents_module.httpx,
        "AsyncClient",
        lambda: fake_client,
    )
    service = ContentService()

    result = asyncio.run(
        service.get_files(
            "http://testserver/ijupyterhub",
            "projects/project",
            "user@example.com",
            "secret-token",
        )
    )

    assert result == directory_model
    assert fake_client.calls[0][0] == (
        "GET",
        "http://testserver/ijupyterhub/user/user@example.com/api/contents/projects/project",
    )


@pytest.mark.parametrize(
    ("status_code", "error_type"),
    [
        (400, BadRequestError),
        (401, UnauthorizedError),
        (403, ForbiddenError),
        (404, NotFoundError),
        (503, UpstreamServiceError),
    ],
)
def test_upstream_status_errors_are_translated(monkeypatch, status_code, error_type):
    fake_client = FakeAsyncClient(FakeResponse(status_code=status_code))
    monkeypatch.setattr(
        contents_module.httpx,
        "AsyncClient",
        lambda: fake_client,
    )
    service = ContentService()

    with pytest.raises(error_type) as exc_info:
        asyncio.run(
            service.read_content(
                "http://testserver/ijupyterhub",
                "projects/project/demo.ipynb",
                "user@example.com",
                "secret-token",
            )
        )

    if isinstance(exc_info.value, UpstreamServiceError):
        assert exc_info.value.status_code == status_code


def test_read_content_does_not_use_path_only_cache(monkeypatch):
    response_by_user = {
        "first@example.com": {"content": "first"},
        "second@example.com": {"content": "second"},
    }

    class PerUserClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def request(self, _method, url, **_kwargs):
            if "first@example.com" in url:
                return FakeResponse(response_by_user["first@example.com"])
            return FakeResponse(response_by_user["second@example.com"])

    monkeypatch.setattr(contents_module.httpx, "AsyncClient", lambda: PerUserClient())
    service = ContentService()

    first = asyncio.run(
        service.read_content(
            "http://testserver/",
            "projects/shared/demo.ipynb",
            "first@example.com",
            "first-token",
        )
    )
    second = asyncio.run(
        service.read_content(
            "http://testserver/",
            "projects/shared/demo.ipynb",
            "second@example.com",
            "second-token",
        )
    )

    assert first == {"content": "first"}
    assert second == {"content": "second"}
