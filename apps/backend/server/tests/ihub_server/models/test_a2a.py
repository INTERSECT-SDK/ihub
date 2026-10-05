import pytest
from pydantic import ValidationError

from ihub_server.models import (
    RemoteAgentServerCreate,
    to_protocol_agent_card,
    validate_a2a_agent_card,
)


def current_agent_card() -> dict:
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
        "capabilities": {"streaming": True, "pushNotifications": False},
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["text/plain"],
        "skills": [
            {
                "id": "research",
                "name": "Research",
                "description": "Find supporting evidence.",
                "tags": ["research", "citations"],
            }
        ],
    }


def test_validates_current_a2a_agent_card_with_official_sdk():
    card = validate_a2a_agent_card(current_agent_card())

    assert card.name == "Research Agent"
    assert str(card.supported_interfaces[0].url) == "https://agent.example.com/a2a"
    assert card.supported_interfaces[0].protocol_binding == "JSONRPC"


def test_accepts_legacy_a2a_agent_card_discovery_shape():
    payload = current_agent_card()
    payload.pop("supportedInterfaces")
    payload.update(
        {
            "url": "https://agent.example.com/a2a",
            "protocolVersion": "0.3.0",
            "preferredTransport": "JSONRPC",
        }
    )

    card = validate_a2a_agent_card(payload)
    protocol_card = to_protocol_agent_card(payload)

    assert str(card.url) == "https://agent.example.com/a2a"
    assert card.protocol_version == "0.3.0"
    assert protocol_card.supported_interfaces[0].protocol_version == "0.3.0"


def test_rejects_agent_card_without_an_interface():
    payload = current_agent_card()
    payload.pop("supportedInterfaces")

    with pytest.raises(ValidationError, match="supportedInterfaces or url"):
        validate_a2a_agent_card(payload)


def test_rejects_unknown_remote_agent_protocol():
    with pytest.raises(ValidationError, match="Unsupported remote-agent protocol"):
        RemoteAgentServerCreate(
            name="Unsupported",
            url="https://agent.example.com",
            protocol="unknown",
        )
