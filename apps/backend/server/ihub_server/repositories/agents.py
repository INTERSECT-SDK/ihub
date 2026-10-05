"""Repository helpers for Agent CRUD operations."""

from typing import cast
from uuid import UUID

from sqlmodel import Session, or_, select

from ihub_server.models import Agent, AgentCreate, AgentUpdate


def list_agents(
    session: Session, offset: int, limit: int, project_id: UUID | None = None
) -> list[Agent]:
    statement = select(Agent)
    if project_id is not None:
        statement = statement.where(
            or_(Agent.project_id == project_id, Agent.project_id.is_(None))  # type: ignore[union-attr]
        )
    return cast(list[Agent], session.exec(statement.offset(offset).limit(limit)).all())


def get_agent(session: Session, agent_id) -> Agent | None:
    return session.get(Agent, agent_id)


def create_agent(session: Session, agent: AgentCreate) -> Agent:
    db_agent = Agent.model_validate(agent)
    session.add(db_agent)
    session.commit()
    session.refresh(db_agent)
    return db_agent


def update_agent(session: Session, agent: Agent, updates: AgentUpdate) -> Agent:
    agent_data = updates.model_dump(exclude_unset=True)
    agent.sqlmodel_update(agent_data)
    session.add(agent)
    session.commit()
    session.refresh(agent)
    return agent


def delete_agent(session: Session, agent: Agent) -> None:
    session.delete(agent)
    session.commit()
