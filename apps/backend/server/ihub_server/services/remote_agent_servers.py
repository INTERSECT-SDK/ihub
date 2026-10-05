"""Service layer for remote agent discovery and connectivity."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

import httpx
from a2a.client import Client, ClientConfig, ClientFactory
from a2a.utils.constants import TransportProtocol
from langgraph_sdk import get_client, get_sync_client
from pydantic import ValidationError

if TYPE_CHECKING:
    from uuid import UUID

    from sqlmodel import Session

from ihub_server.models import (
    A2AAgentCard,
    RemoteAgent,
    RemoteAgentServer,
    RemoteAgentServerCreate,
    RemoteAgentServerUpdate,
    to_protocol_agent_card,
    validate_a2a_agent_card,
)
from ihub_server.repositories import remote_agent_servers as remote_agent_server_repository
from ihub_server.repositories import remote_agents as remote_agent_repository
from ihub_server.services.errors import NotFoundError


class RemoteAgentServerService:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_remote_agent_servers(self, offset: int, limit: int) -> list[RemoteAgentServer]:
        return remote_agent_server_repository.list_remote_agents(self._session, offset, limit)

    def list_remote_agent_servers_for_project(
        self, project_id: UUID, offset: int, limit: int
    ) -> list[RemoteAgentServer]:
        """List remote agent servers scoped to a specific project."""
        return remote_agent_server_repository.list_remote_agents_for_project(
            self._session, project_id, offset, limit
        )

    def get_remote_agent(self, remote_agent_id: int) -> RemoteAgentServer:
        remote_agent = remote_agent_server_repository.get_remote_agent(
            self._session,
            remote_agent_id,
        )
        if not remote_agent:
            msg = "Remote agent server not found"
            raise NotFoundError(msg)
        return remote_agent

    def create_remote_agent(self, remote_agent: RemoteAgentServerCreate) -> RemoteAgentServer:
        return remote_agent_server_repository.create_remote_agent(self._session, remote_agent)

    def update_remote_agent(
        self,
        remote_agent_id: int,
        updates: RemoteAgentServerUpdate,
    ) -> RemoteAgentServer:
        remote_agent = remote_agent_server_repository.get_remote_agent(
            self._session,
            remote_agent_id,
        )
        if not remote_agent:
            msg = "Remote agent server not found"
            raise NotFoundError(msg)

        update_data = updates.model_dump(exclude_unset=True)
        update_data["updated_at"] = datetime.now(UTC)
        updates_with_timestamp = RemoteAgentServerUpdate.model_validate(update_data)
        return remote_agent_server_repository.update_remote_agent(
            self._session,
            remote_agent,
            updates_with_timestamp,
        )

    def delete_remote_agent(self, remote_agent_id: int) -> None:
        remote_agent = remote_agent_server_repository.get_remote_agent(
            self._session,
            remote_agent_id,
        )
        if not remote_agent:
            msg = "Remote agent server not found"
            raise NotFoundError(msg)

        # Delete all associated remote agents first.
        remote_agent_repository.delete_all_remote_agents_for_server(
            self._session,
            remote_agent_id,
        )

        # Then delete the remote agent server itself
        remote_agent_server_repository.delete_remote_agent(self._session, remote_agent)

    def list_remote_agents(self, offset: int, limit: int) -> list[RemoteAgent]:
        return remote_agent_repository.list_remote_agents(self._session, offset, limit)

    def list_remote_agents_for_remote_agent_server(
        self,
        remote_agent_id: int,
    ) -> list[RemoteAgent]:
        self.get_remote_agent(remote_agent_id)
        return remote_agent_repository.list_remote_agents_for_remote_agent_server(
            self._session,
            remote_agent_id,
        )

    def get_discovered_remote_agent(
        self,
        remote_agent_server_id: int,
        remote_agent_id: str,
    ) -> RemoteAgent:
        """Return one discovered agent belonging to a configured deployment."""
        self.get_remote_agent(remote_agent_server_id)
        remote_agent = remote_agent_repository.get_remote_agent_by_key(
            self._session,
            remote_agent_server_id,
            remote_agent_id,
        )
        if remote_agent is None:
            msg = "Discovered remote agent not found"
            raise NotFoundError(msg)
        return remote_agent

    async def get_a2a_client(
        self,
        remote_agent: RemoteAgentServer,
        discovered_agent: RemoteAgent,
    ) -> Client:
        """Create an authenticated SDK client from a cached A2A Agent Card."""
        if remote_agent.protocol != "a2a" or discovered_agent.protocol != "a2a":
            msg = "Remote agent is not configured for A2A"
            raise ValueError(msg)

        card = to_protocol_agent_card(discovered_agent.assistant_metadata or {})
        http_client = httpx.AsyncClient(
            timeout=30,
            headers=self.build_auth_headers(remote_agent),
            verify=True,
            follow_redirects=True,
        )
        config = ClientConfig(
            httpx_client=http_client,
            streaming=True,
            supported_protocol_bindings=[
                TransportProtocol.JSONRPC.value,
                TransportProtocol.HTTP_JSON.value,
            ],
            use_client_preference=True,
            accepted_output_modes=list(card.default_output_modes),
        )
        try:
            return ClientFactory(config).create(card)
        except Exception:
            await http_client.aclose()
            raise

    def get_agui_client(self, remote_agent: RemoteAgentServer) -> httpx.AsyncClient:
        """Create an authenticated client for an AG-UI POST/SSE endpoint."""
        if remote_agent.protocol != "agui":
            msg = "Remote agent is not configured for AG-UI"
            raise ValueError(msg)
        return httpx.AsyncClient(
            timeout=httpx.Timeout(300, connect=10),
            headers={
                **self.build_auth_headers(remote_agent),
                "Accept": "text/event-stream",
            },
            verify=True,
            follow_redirects=True,
        )

    def sync_remote_agents(self, remote_agent_id: int) -> list[RemoteAgent]:
        remote_agent = self.get_remote_agent(remote_agent_id)
        if remote_agent.protocol == "a2a":
            return self._sync_a2a_agent(remote_agent)
        if remote_agent.protocol == "agui":
            return self._sync_agui_agent(remote_agent)
        return self._sync_langgraph_agents(remote_agent)

    def _sync_langgraph_agents(
        self,
        remote_agent: RemoteAgentServer,
    ) -> list[RemoteAgent]:
        """Discover assistants exposed by a LangGraph deployment."""
        if remote_agent.id is None:
            msg = "Remote agent server must be persisted before synchronization"
            raise ValueError(msg)

        client = self.get_sync_client(remote_agent)

        discovered: list[dict[str, Any]] = []
        limit = 100
        offset = 0

        try:
            while True:
                page = client.assistants.search(limit=limit, offset=offset)
                if not page:
                    break
                discovered.extend(page)
                if len(page) < limit:
                    break
                offset += limit
        except (httpx.HTTPError, ValueError):
            # Mark server unavailable when sync cannot reach or parse remote agents.
            remote_agent.status = "unavailable"
            remote_agent.updated_at = datetime.now(UTC)
            self._session.add(remote_agent)
            self._session.commit()
            raise
        finally:
            client.close()

        keep_ids: set[str] = set()

        for discovered_agent in discovered:
            remote_runtime_agent_id = str(discovered_agent.get("assistant_id", "")).strip()
            if not remote_runtime_agent_id:
                continue

            keep_ids.add(remote_runtime_agent_id)
            remote_agent_repository.upsert_remote_agent(
                self._session,
                remote_agent_server_id=remote_agent.id,
                remote_agent_id=remote_runtime_agent_id,
                protocol="langgraph",
                graph_id=discovered_agent.get("graph_id"),
                name=str(discovered_agent.get("name") or remote_runtime_agent_id),
                description=discovered_agent.get("description"),
                assistant_metadata=discovered_agent.get("metadata"),
                version=int(discovered_agent.get("version") or 1),
                remote_updated_at=discovered_agent.get("updated_at"),
            )

        remote_agent_repository.delete_missing_remote_agents(
            self._session,
            remote_agent_server_id=remote_agent.id,
            remote_agent_ids_to_keep=keep_ids,
        )

        # Update server status based on whether the remote returned agents.
        remote_agent.status = "available" if len(keep_ids) > 0 else "unavailable"
        remote_agent.updated_at = datetime.now(UTC)
        self._session.add(remote_agent)
        self._session.commit()

        return remote_agent_repository.list_remote_agents_for_remote_agent_server(
            self._session,
            remote_agent.id,
        )

    def _sync_a2a_agent(self, remote_agent: RemoteAgentServer) -> list[RemoteAgent]:
        """Fetch, validate, and cache one A2A Agent Card."""
        if remote_agent.id is None:
            msg = "Remote agent server must be persisted before synchronization"
            raise ValueError(msg)

        try:
            agent_card = self.fetch_a2a_agent_card(remote_agent)
        except (httpx.HTTPError, ValidationError, ValueError):
            self._mark_unavailable(remote_agent)
            raise

        catalog_key = "agent-card"
        card_metadata = agent_card.model_dump(mode="json", by_alias=True, exclude_none=True)
        remote_agent_repository.upsert_remote_agent(
            self._session,
            remote_agent_server_id=remote_agent.id,
            remote_agent_id=catalog_key,
            protocol="a2a",
            graph_id=None,
            name=agent_card.name,
            description=agent_card.description,
            assistant_metadata=card_metadata,
            version=1,
            remote_updated_at=None,
        )
        remote_agent_repository.delete_missing_remote_agents(
            self._session,
            remote_agent_server_id=remote_agent.id,
            remote_agent_ids_to_keep={catalog_key},
        )

        remote_agent.status = "available"
        remote_agent.updated_at = datetime.now(UTC)
        self._session.add(remote_agent)
        self._session.commit()
        return remote_agent_repository.list_remote_agents_for_remote_agent_server(
            self._session,
            remote_agent.id,
        )

    def _sync_agui_agent(self, remote_agent: RemoteAgentServer) -> list[RemoteAgent]:
        """Register one discovered agent for an AG-UI endpoint.

        AG-UI capability discovery is optional and is not a mandatory HTTP
        endpoint. A configured URL therefore represents one agent; an OPTIONS
        probe only determines reachability and never starts an agent run.
        """
        if remote_agent.id is None:
            msg = "Remote agent server must be persisted before synchronization"
            raise ValueError(msg)

        catalog_key = "ag-ui-endpoint"
        reachable = self._probe_agui_endpoint(remote_agent)
        metadata = {
            "identity": {
                "name": remote_agent.name,
                "description": "Agent exposed through an AG-UI endpoint.",
            },
            "transport": {"streaming": True},
            "endpoint": remote_agent.url,
        }
        remote_agent_repository.upsert_remote_agent(
            self._session,
            remote_agent_server_id=remote_agent.id,
            remote_agent_id=catalog_key,
            protocol="agui",
            graph_id=None,
            name=remote_agent.name,
            description="Agent exposed through an AG-UI endpoint.",
            assistant_metadata=metadata,
            version=1,
            remote_updated_at=None,
        )
        remote_agent_repository.delete_missing_remote_agents(
            self._session,
            remote_agent_server_id=remote_agent.id,
            remote_agent_ids_to_keep={catalog_key},
        )

        remote_agent.status = "available" if reachable else "unavailable"
        remote_agent.updated_at = datetime.now(UTC)
        self._session.add(remote_agent)
        self._session.commit()
        return remote_agent_repository.list_remote_agents_for_remote_agent_server(
            self._session,
            remote_agent.id,
        )

    def _probe_agui_endpoint(self, remote_agent: RemoteAgentServer) -> bool:
        """Check endpoint reachability without issuing a RunAgentInput."""
        try:
            with httpx.Client(
                timeout=10,
                headers=self.build_auth_headers(remote_agent),
                verify=True,
                follow_redirects=True,
            ) as client:
                response = client.options(remote_agent.url)
                return response.status_code < 500 and response.status_code not in {
                    401,
                    403,
                    404,
                }
        except (httpx.HTTPError, ValueError):
            return False

    def fetch_a2a_agent_card(self, remote_agent: RemoteAgentServer) -> A2AAgentCard:
        """Retrieve the public Agent Card from the A2A well-known endpoint."""
        card_url = self.get_a2a_agent_card_url(remote_agent.url)
        with httpx.Client(
            timeout=10,
            headers=self.build_auth_headers(remote_agent),
            verify=True,
            follow_redirects=True,
        ) as client:
            response = client.get(card_url)
            response.raise_for_status()
            return validate_a2a_agent_card(response.json())

    @staticmethod
    def get_a2a_agent_card_url(base_url: str) -> str:
        """Resolve the standard Agent Card URL from a configured base URL."""
        normalized_url = base_url.rstrip("/")
        if normalized_url.endswith("/.well-known/agent-card.json"):
            return normalized_url
        return f"{normalized_url}/.well-known/agent-card.json"

    def _mark_unavailable(self, remote_agent: RemoteAgentServer) -> None:
        remote_agent.status = "unavailable"
        remote_agent.updated_at = datetime.now(UTC)
        self._session.add(remote_agent)
        self._session.commit()

    def sync_all_remote_agents(self) -> dict[str, int]:
        remote_agents = self.list_remote_agent_servers(0, 1000)
        synced_servers = 0
        synced_agents = 0

        for remote_agent in remote_agents:
            if remote_agent.id is None:
                continue
            discovered_agents = self.sync_remote_agents(remote_agent.id)
            synced_servers += 1
            synced_agents += len(discovered_agents)

        return {
            "synced_servers": synced_servers,
            "synced_agents": synced_agents,
        }

    def build_auth_headers(self, remote_agent: RemoteAgentServer) -> dict[str, str]:
        auth_token = remote_agent.auth_token
        if not auth_token:
            return {}
        # Default to Bearer auth for simplicity
        return {"Authorization": f"Bearer {auth_token}"}

    def get_sync_client(self, remote_agent: RemoteAgentServer):
        return get_sync_client(
            url=remote_agent.url,
            api_key=None,
            headers=self.build_auth_headers(remote_agent),
            timeout=30,
        )

    def get_async_client(self, remote_agent: RemoteAgentServer):
        return get_client(
            url=remote_agent.url,
            api_key=None,
            headers=self.build_auth_headers(remote_agent),
            timeout=30,
        )

    def health_check(self, remote_agent_id: int) -> dict[str, bool]:
        remote_agent = self.get_remote_agent(remote_agent_id)

        if remote_agent.protocol == "a2a":
            return self._health_check_a2a_agent(remote_agent)
        if remote_agent.protocol == "agui":
            reachable = self._probe_agui_endpoint(remote_agent)
            remote_agent.status = "available" if reachable else "unavailable"
            remote_agent.updated_at = datetime.now(UTC)
            self._session.add(remote_agent)
            self._session.commit()
            return {
                "reachable": reachable,
                "assistant_available": reachable,
            }

        reachable = False
        assistant_available = False

        try:
            with httpx.Client(
                timeout=10,
                headers=self.build_auth_headers(remote_agent),
                verify=True,
            ) as client:
                response = client.get(remote_agent.url)
                reachable = response.status_code < 500
        except (httpx.HTTPError, ValueError):
            reachable = False

        if reachable:
            client = self.get_sync_client(remote_agent)
            try:
                discovered_agents = client.assistants.search(limit=1, offset=0)
                assistant_available = len(discovered_agents) > 0
            except (httpx.HTTPError, ValueError):
                assistant_available = False
            finally:
                client.close()

        remote_agent.status = "available" if assistant_available else "unavailable"
        remote_agent.updated_at = datetime.now(UTC)
        self._session.add(remote_agent)
        self._session.commit()

        return {
            "reachable": reachable,
            "assistant_available": assistant_available,
        }

    def _health_check_a2a_agent(self, remote_agent: RemoteAgentServer) -> dict[str, bool]:
        """Check whether an A2A deployment publishes a valid Agent Card."""
        reachable = False
        agent_available = False
        try:
            self.fetch_a2a_agent_card(remote_agent)
            reachable = True
            agent_available = True
        except (httpx.HTTPError, ValidationError, ValueError):
            pass

        remote_agent.status = "available" if agent_available else "unavailable"
        remote_agent.updated_at = datetime.now(UTC)
        self._session.add(remote_agent)
        self._session.commit()
        return {
            "reachable": reachable,
            "assistant_available": agent_available,
        }
