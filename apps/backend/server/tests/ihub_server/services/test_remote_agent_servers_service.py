import asyncio
from unittest.mock import MagicMock

import pytest

from ihub_server.models import RemoteAgent, RemoteAgentServer, validate_a2a_agent_card
from ihub_server.services import remote_agent_servers as service_module
from ihub_server.services.remote_agent_servers import RemoteAgentServerService


def agent_card_payload() -> dict:
    return {
        "name": "Research Agent",
        "description": "Finds and summarizes evidence.",
        "supportedInterfaces": [
            {
                "url": "https://agent.example.com/a2a",
                "protocolBinding": "JSONRPC",
                "protocolVersion": "1.0",
            }
        ],
        "version": "2.1.0",
        "capabilities": {"streaming": True},
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["text/plain"],
        "skills": [
            {
                "id": "research",
                "name": "Research",
                "description": "Find supporting evidence.",
                "tags": ["research"],
            }
        ],
    }


def test_a2a_sync_caches_agent_card_and_marks_deployment_available(monkeypatch):
    session = MagicMock()
    service = RemoteAgentServerService(session)
    server = RemoteAgentServer(
        id=7,
        name="Research deployment",
        url="https://agent.example.com",
        protocol="a2a",
    )
    card = validate_a2a_agent_card(agent_card_payload())
    discovered = RemoteAgent(
        id=11,
        remote_agent_id=7,
        assistant_id="agent-card",
        protocol="a2a",
        name=card.name,
        description=card.description,
    )
    upsert = MagicMock()
    delete_missing = MagicMock()

    monkeypatch.setattr(service, "get_remote_agent", lambda _remote_agent_id: server)
    monkeypatch.setattr(service, "fetch_a2a_agent_card", lambda _server: card)
    monkeypatch.setattr(service_module.remote_agent_repository, "upsert_remote_agent", upsert)
    monkeypatch.setattr(
        service_module.remote_agent_repository,
        "delete_missing_remote_agents",
        delete_missing,
    )
    monkeypatch.setattr(
        service_module.remote_agent_repository,
        "list_remote_agents_for_remote_agent_server",
        lambda _session, _server_id: [discovered],
    )

    result = service.sync_remote_agents(7)

    assert result == [discovered]
    assert server.status == "available"
    upsert.assert_called_once()
    assert upsert.call_args.kwargs["protocol"] == "a2a"
    assert upsert.call_args.kwargs["remote_agent_id"] == "agent-card"
    assert upsert.call_args.kwargs["assistant_metadata"]["version"] == "2.1.0"
    delete_missing.assert_called_once_with(
        session,
        remote_agent_server_id=7,
        remote_agent_ids_to_keep={"agent-card"},
    )
    session.commit.assert_called_once()


def test_a2a_sync_marks_deployment_unavailable_when_card_fetch_fails(monkeypatch):
    session = MagicMock()
    service = RemoteAgentServerService(session)
    server = RemoteAgentServer(
        id=7,
        name="Research deployment",
        url="https://agent.example.com",
        protocol="a2a",
    )

    def fail_fetch(_server):
        raise ValueError("invalid card")

    monkeypatch.setattr(service, "get_remote_agent", lambda _remote_agent_id: server)
    monkeypatch.setattr(service, "fetch_a2a_agent_card", fail_fetch)

    with pytest.raises(ValueError, match="invalid card"):
        service.sync_remote_agents(7)

    assert server.status == "unavailable"
    session.commit.assert_called_once()


@pytest.mark.parametrize(
    ("configured_url", "expected_url"),
    [
        (
            "https://agent.example.com",
            "https://agent.example.com/.well-known/agent-card.json",
        ),
        (
            "https://agent.example.com/",
            "https://agent.example.com/.well-known/agent-card.json",
        ),
        (
            "https://agent.example.com/.well-known/agent-card.json",
            "https://agent.example.com/.well-known/agent-card.json",
        ),
    ],
)
def test_resolves_a2a_agent_card_url(configured_url, expected_url):
    assert RemoteAgentServerService.get_a2a_agent_card_url(configured_url) == expected_url


def test_creates_a2a_sdk_client_from_cached_agent_card():
    service = RemoteAgentServerService(MagicMock())
    server = RemoteAgentServer(
        id=7,
        name="Research deployment",
        url="https://agent.example.com",
        protocol="a2a",
        auth_token="secret-token",
    )
    discovered = RemoteAgent(
        id=11,
        remote_agent_id=7,
        assistant_id="agent-card",
        protocol="a2a",
        name="Research Agent",
        assistant_metadata=agent_card_payload(),
    )

    async def create_and_close_client():
        client = await service.get_a2a_client(server, discovered)
        assert client._card.name == "Research Agent"
        assert client._config.httpx_client.headers["Authorization"] == "Bearer secret-token"
        await client.close()

    asyncio.run(create_and_close_client())


def test_agui_sync_registers_endpoint_as_one_discovered_agent(monkeypatch):
    session = MagicMock()
    service = RemoteAgentServerService(session)
    server = RemoteAgentServer(
        id=8,
        name="Interactive agent",
        url="https://agent.example.com/agui",
        protocol="agui",
    )
    discovered = RemoteAgent(
        id=12,
        remote_agent_id=8,
        assistant_id="ag-ui-endpoint",
        protocol="agui",
        name="Interactive agent",
    )
    upsert = MagicMock()

    monkeypatch.setattr(service, "get_remote_agent", lambda _remote_agent_id: server)
    monkeypatch.setattr(service, "_probe_agui_endpoint", lambda _server: True)
    monkeypatch.setattr(service_module.remote_agent_repository, "upsert_remote_agent", upsert)
    monkeypatch.setattr(
        service_module.remote_agent_repository,
        "delete_missing_remote_agents",
        MagicMock(),
    )
    monkeypatch.setattr(
        service_module.remote_agent_repository,
        "list_remote_agents_for_remote_agent_server",
        lambda _session, _server_id: [discovered],
    )

    result = service.sync_remote_agents(8)

    assert result == [discovered]
    assert server.status == "available"
    assert upsert.call_args.kwargs["protocol"] == "agui"
    assert upsert.call_args.kwargs["remote_agent_id"] == "ag-ui-endpoint"
    assert upsert.call_args.kwargs["assistant_metadata"]["endpoint"] == server.url
    session.commit.assert_called_once()


def test_creates_authenticated_agui_client():
    service = RemoteAgentServerService(MagicMock())
    server = RemoteAgentServer(
        id=8,
        name="Interactive agent",
        url="https://agent.example.com/agui",
        protocol="agui",
        auth_token="secret-token",
    )

    client = service.get_agui_client(server)

    assert client.headers["Authorization"] == "Bearer secret-token"
    assert client.headers["Accept"] == "text/event-stream"
    asyncio.run(client.aclose())
