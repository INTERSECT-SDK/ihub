import pytest

from ihub_server.models import MCPServerCreate, MCPServerUpdate
from ihub_server.services import mcp_servers as mcp_module
from ihub_server.services.errors import NotFoundError
from ihub_server.services.mcp_servers import MCPServerService


def test_list_mcp_servers(monkeypatch):
    service = MCPServerService(session=None)
    monkeypatch.setattr(mcp_module.mcp_repository, "list_mcp_servers", lambda *_a: ["mcp"])

    assert service.list_mcp_servers(0, 10) == ["mcp"]


def test_get_mcp_server_missing(monkeypatch):
    service = MCPServerService(session=None)
    monkeypatch.setattr(mcp_module.mcp_repository, "get_mcp_server", lambda *_a: None)

    with pytest.raises(NotFoundError):
        service.get_mcp_server(1)


def test_create_mcp_server(monkeypatch):
    service = MCPServerService(session=None)
    monkeypatch.setattr(mcp_module.mcp_repository, "create_mcp_server", lambda *_a: "created")

    assert (
        service.create_mcp_server(
            MCPServerCreate(label="mcp", url="http://localhost:9000", token="token")
        )
        == "created"
    )


def test_update_mcp_server_missing(monkeypatch):
    service = MCPServerService(session=None)
    monkeypatch.setattr(mcp_module.mcp_repository, "get_mcp_server", lambda *_a: None)

    with pytest.raises(NotFoundError):
        service.update_mcp_server(1, MCPServerUpdate())


def test_delete_mcp_server_missing(monkeypatch):
    service = MCPServerService(session=None)
    monkeypatch.setattr(mcp_module.mcp_repository, "get_mcp_server", lambda *_a: None)

    with pytest.raises(NotFoundError):
        service.delete_mcp_server(1)


def test_get_mcp_server_success(monkeypatch):
    service = MCPServerService(session=None)
    expected = object()
    monkeypatch.setattr(mcp_module.mcp_repository, "get_mcp_server", lambda *_a: expected)

    assert service.get_mcp_server(1) == expected


def test_update_mcp_server_success(monkeypatch):
    service = MCPServerService(session=None)
    existing = object()
    monkeypatch.setattr(mcp_module.mcp_repository, "get_mcp_server", lambda *_a: existing)
    monkeypatch.setattr(mcp_module.mcp_repository, "update_mcp_server", lambda *_a: "updated")

    assert service.update_mcp_server(1, MCPServerUpdate()) == "updated"


def test_delete_mcp_server_success(monkeypatch):
    service = MCPServerService(session=None)
    existing = object()
    monkeypatch.setattr(mcp_module.mcp_repository, "get_mcp_server", lambda *_a: existing)

    calls = {}

    def fake_delete(_session, server):
        calls["server"] = server

    monkeypatch.setattr(mcp_module.mcp_repository, "delete_mcp_server", fake_delete)

    service.delete_mcp_server(1)

    assert calls["server"] == existing
