"""ihub-server's startup broker seeding (BROKER_ENABLED and BROKER_*).

The stack runs without any broker configuration by default; with IT_BROKER=1
it adds RabbitMQ and the server seeds and connects it on startup.
"""

import json
import os

import pytest

from browser import Browser

BROKER_ENABLED = bool(os.environ.get("IT_BROKER"))
SEED_BROKER_LABEL = "IT Broker"


def list_brokers(authenticated_browser: Browser) -> list[dict[str, object]]:
    response = authenticated_browser.get("/api/v1/brokers/")
    assert response.status == 200, response.text
    return json.loads(response.text)


@pytest.mark.skipif(BROKER_ENABLED, reason="stack runs with a seed broker (IT_BROKER=1)")
def test_no_broker_is_seeded_without_broker_config(authenticated_browser: Browser) -> None:
    labels = [broker["label"] for broker in list_brokers(authenticated_browser)]

    assert SEED_BROKER_LABEL not in labels


@pytest.mark.skipif(not BROKER_ENABLED, reason="requires the seed broker (IT_BROKER=1)")
def test_seed_broker_is_created_and_connected(authenticated_browser: Browser) -> None:
    seeded = [
        broker
        for broker in list_brokers(authenticated_browser)
        if broker["label"] == SEED_BROKER_LABEL
    ]

    assert len(seeded) == 1
    assert seeded[0]["hostIP"] == "broker"
    assert seeded[0]["status"] == "connected"
