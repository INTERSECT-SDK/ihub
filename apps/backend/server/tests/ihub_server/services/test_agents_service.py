from types import SimpleNamespace
from uuid import uuid4

import pytest

from ihub_server.models import AgentCreate, AgentUpdate
from ihub_server.models.agent import AgentVisibility
from ihub_server.services import agents as agents_module
from ihub_server.services.agents import AgentService
from ihub_server.services.errors import NotFoundError


def _make_agent_create() -> AgentCreate:
    return AgentCreate(
        name="agent",
        description="desc",
        owner_id=uuid4(),
        visibility=AgentVisibility.PRIVATE,
        parent_agent_id=None,
        version=1,
        model_id=None,
        tool_ids=["tool"],
        system_prompt="system",
        graph_type="graph",
        memory_type="memory",
        runtime_config={},
    )


def test_list_agents(monkeypatch):
    service = AgentService(session=None)
    expected = [SimpleNamespace(id="agent")]
    monkeypatch.setattr(agents_module.agent_repository, "list_agents", lambda *_args: expected)

    assert service.list_agents(0, 10) == expected


def test_get_agent_missing(monkeypatch):
    service = AgentService(session=None)
    monkeypatch.setattr(agents_module.agent_repository, "get_agent", lambda *_args: None)

    with pytest.raises(NotFoundError):
        service.get_agent(uuid4())


def test_create_agent(monkeypatch):
    service = AgentService(session=None)
    agent = _make_agent_create()

    monkeypatch.setattr(
        agents_module.agent_repository,
        "create_agent",
        lambda *_args: "created",
    )

    assert service.create_agent(agent) == "created"


def test_update_agent_sets_timestamp(monkeypatch):
    service = AgentService(session=None)
    existing_agent = SimpleNamespace(id=uuid4())
    monkeypatch.setattr(agents_module.agent_repository, "get_agent", lambda *_args: existing_agent)

    captured = {}

    def fake_update(_session, agent, updates):
        captured["agent"] = agent
        captured["updates"] = updates
        return "updated"

    monkeypatch.setattr(agents_module.agent_repository, "update_agent", fake_update)

    updates = AgentUpdate(name="updated")
    result = service.update_agent(existing_agent.id, updates)

    assert result == "updated"
    assert captured["agent"] == existing_agent
    assert isinstance(captured["updates"], AgentUpdate)


def test_delete_agent_missing(monkeypatch):
    service = AgentService(session=None)
    monkeypatch.setattr(agents_module.agent_repository, "get_agent", lambda *_args: None)

    with pytest.raises(NotFoundError):
        service.delete_agent(uuid4())


def test_get_agent_success(monkeypatch):
    service = AgentService(session=None)
    expected = SimpleNamespace(id=uuid4())
    monkeypatch.setattr(agents_module.agent_repository, "get_agent", lambda *_args: expected)

    assert service.get_agent(expected.id) == expected


def test_delete_agent_success(monkeypatch):
    service = AgentService(session=None)
    expected = SimpleNamespace(id=uuid4())
    monkeypatch.setattr(agents_module.agent_repository, "get_agent", lambda *_args: expected)

    called = {}

    def fake_delete(_session, agent):
        called["agent"] = agent

    monkeypatch.setattr(agents_module.agent_repository, "delete_agent", fake_delete)

    service.delete_agent(expected.id)

    assert called["agent"] == expected
