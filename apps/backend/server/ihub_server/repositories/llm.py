"""Repository helpers for LLM CRUD operations."""

from typing import cast
from uuid import UUID

from sqlmodel import Session, or_, select

from ihub_server.models import LLM, LLMCreate, LLMUpdate


def list_llms(
    session: Session, offset: int, limit: int, project_id: UUID | None = None
) -> list[LLM]:
    statement = select(LLM)
    if project_id is not None:
        statement = statement.where(
            or_(LLM.project_id == project_id, LLM.project_id.is_(None))  # type: ignore[union-attr]
        )
    return cast(list[LLM], session.exec(statement.offset(offset).limit(limit)).all())


def get_llm(session: Session, llm_id: int) -> LLM | None:
    return session.get(LLM, llm_id)


def create_llm(session: Session, llm: LLMCreate) -> LLM:
    db_llm = LLM.model_validate(llm)
    session.add(db_llm)
    session.commit()
    session.refresh(db_llm)
    return db_llm


def update_llm(session: Session, llm: LLM, updates: LLMUpdate) -> LLM:
    llm_data = updates.model_dump(exclude_unset=True)
    llm.sqlmodel_update(llm_data)
    session.add(llm)
    session.commit()
    session.refresh(llm)
    return llm


def delete_llm(session: Session, llm: LLM) -> None:
    session.delete(llm)
    session.commit()
