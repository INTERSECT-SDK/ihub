from types import SimpleNamespace

import pytest

from ihub_server.models import JupyterCreate, JupyterUpdate
from ihub_server.services import jupyter_servers as jupyter_module
from ihub_server.services.errors import NotFoundError
from ihub_server.services.jupyter_servers import JupyterServerService


def test_list_jupyter_servers(monkeypatch):
    service = JupyterServerService(session=None)
    monkeypatch.setattr(
        jupyter_module.jupyter_repository, "list_jupyter_servers", lambda *_a: ["srv"]
    )

    assert service.list_jupyter_servers(0, 10) == ["srv"]


def test_get_jupyter_server_missing(monkeypatch):
    service = JupyterServerService(session=None)
    monkeypatch.setattr(jupyter_module.jupyter_repository, "get_jupyter_server", lambda *_a: None)

    with pytest.raises(NotFoundError):
        service.get_jupyter_server(1)


def test_get_jupyter_server_by_label_missing(monkeypatch):
    service = JupyterServerService(session=None)
    monkeypatch.setattr(
        jupyter_module.jupyter_repository,
        "get_jupyter_server_by_label",
        lambda *_a: None,
    )

    with pytest.raises(NotFoundError):
        service.get_jupyter_server_by_label("label")


def test_create_jupyter_server(monkeypatch):
    service = JupyterServerService(session=None)
    monkeypatch.setattr(
        jupyter_module.jupyter_repository,
        "create_jupyter_server",
        lambda *_a: "created",
    )

    assert (
        service.create_jupyter_server(JupyterCreate(label="l", hostIP="h", port="1", token="t"))
        == "created"
    )


def test_update_jupyter_server_missing(monkeypatch):
    service = JupyterServerService(session=None)
    monkeypatch.setattr(jupyter_module.jupyter_repository, "get_jupyter_server", lambda *_a: None)

    with pytest.raises(NotFoundError):
        service.update_jupyter_server(1, JupyterUpdate())


def test_delete_jupyter_server_missing(monkeypatch):
    service = JupyterServerService(session=None)
    monkeypatch.setattr(jupyter_module.jupyter_repository, "get_jupyter_server", lambda *_a: None)

    with pytest.raises(NotFoundError):
        service.delete_jupyter_server(1)


def test_update_jupyter_server_success(monkeypatch):
    service = JupyterServerService(session=None)
    existing = SimpleNamespace(id=1)
    monkeypatch.setattr(
        jupyter_module.jupyter_repository, "get_jupyter_server", lambda *_a: existing
    )

    monkeypatch.setattr(
        jupyter_module.jupyter_repository,
        "update_jupyter_server",
        lambda *_a: "updated",
    )

    assert service.update_jupyter_server(1, JupyterUpdate()) == "updated"


def test_get_jupyter_server_success(monkeypatch):
    service = JupyterServerService(session=None)
    expected = SimpleNamespace(id=1)
    monkeypatch.setattr(
        jupyter_module.jupyter_repository, "get_jupyter_server", lambda *_a: expected
    )

    assert service.get_jupyter_server(1) == expected


def test_delete_jupyter_server_success(monkeypatch):
    service = JupyterServerService(session=None)
    expected = SimpleNamespace(id=1)
    monkeypatch.setattr(
        jupyter_module.jupyter_repository, "get_jupyter_server", lambda *_a: expected
    )

    calls = {}

    def fake_delete(_session, server):
        calls["server"] = server

    monkeypatch.setattr(jupyter_module.jupyter_repository, "delete_jupyter_server", fake_delete)

    service.delete_jupyter_server(1)

    assert calls["server"] == expected
