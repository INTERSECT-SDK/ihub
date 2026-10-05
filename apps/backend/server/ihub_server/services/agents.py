"""Service layer for Agent CRUD operations with timestamp updates."""

from datetime import UTC, datetime
from uuid import UUID

from sqlmodel import Session

from ihub_server.models import Agent, AgentCreate, AgentUpdate
from ihub_server.repositories import agents as agent_repository
from ihub_server.services.errors import NotFoundError


class AgentService:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_agents(self, offset: int, limit: int, project_id: UUID | None = None) -> list[Agent]:
        return agent_repository.list_agents(self._session, offset, limit, project_id)

    def get_agent(self, agent_id: UUID) -> Agent:
        agent = agent_repository.get_agent(self._session, agent_id)
        if not agent:
            msg = "Agent not found."
            raise NotFoundError(msg)
        return agent

    def create_agent(self, agent: AgentCreate) -> Agent:
        return agent_repository.create_agent(self._session, agent)

    def update_agent(self, agent_id: UUID, updates: AgentUpdate) -> Agent:
        agent = agent_repository.get_agent(self._session, agent_id)
        if not agent:
            msg = "Agent not found."
            raise NotFoundError(msg)
        update_data = updates.model_dump(exclude_unset=True)
        update_data["updated_at"] = datetime.now(UTC)
        updates_with_timestamp = AgentUpdate.model_validate(update_data)
        return agent_repository.update_agent(self._session, agent, updates_with_timestamp)

    def delete_agent(self, agent_id: UUID) -> None:
        agent = agent_repository.get_agent(self._session, agent_id)
        if not agent:
            msg = "Agent not found."
            raise NotFoundError(msg)
        agent_repository.delete_agent(self._session, agent)
