import pytest

from ihub_server.models import LLMCreate, LLMUpdate
from ihub_server.services import llm as llm_module
from ihub_server.services.errors import NotFoundError
from ihub_server.services.llm import LLMService


def test_list_llms(monkeypatch):
    service = LLMService(session=None)
    monkeypatch.setattr(llm_module.llm_repository, "list_llms", lambda *_a: ["llm"])

    assert service.list_llms(0, 10) == ["llm"]


def test_get_llm_missing(monkeypatch):
    service = LLMService(session=None)
    monkeypatch.setattr(llm_module.llm_repository, "get_llm", lambda *_a: None)

    with pytest.raises(NotFoundError):
        service.get_llm(1)


def test_create_llm(monkeypatch):
    service = LLMService(session=None)
    monkeypatch.setattr(llm_module.llm_repository, "create_llm", lambda *_a: "created")

    assert (
        service.create_llm(
            LLMCreate(
                label="llm",
                url="http://llm:8080",
                provider="provider",
                model="model",
            )
        )
        == "created"
    )


def test_update_llm_missing(monkeypatch):
    service = LLMService(session=None)
    monkeypatch.setattr(llm_module.llm_repository, "get_llm", lambda *_a: None)

    with pytest.raises(NotFoundError):
        service.update_llm(1, LLMUpdate())


def test_delete_llm_missing(monkeypatch):
    service = LLMService(session=None)
    monkeypatch.setattr(llm_module.llm_repository, "get_llm", lambda *_a: None)

    with pytest.raises(NotFoundError):
        service.delete_llm(1)


def test_update_llm_success(monkeypatch):
    service = LLMService(session=None)
    existing = object()
    monkeypatch.setattr(llm_module.llm_repository, "get_llm", lambda *_a: existing)
    monkeypatch.setattr(llm_module.llm_repository, "update_llm", lambda *_a: "updated")

    assert service.update_llm(1, LLMUpdate()) == "updated"


def test_delete_llm_success(monkeypatch):
    service = LLMService(session=None)
    existing = object()
    monkeypatch.setattr(llm_module.llm_repository, "get_llm", lambda *_a: existing)

    called = {}

    def fake_delete(_session, llm):
        called["llm"] = llm

    monkeypatch.setattr(llm_module.llm_repository, "delete_llm", fake_delete)

    service.delete_llm(1)

    assert called["llm"] == existing
