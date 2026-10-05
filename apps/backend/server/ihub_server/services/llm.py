"""Service layer for LLM CRUD operations."""

from uuid import UUID

from sqlmodel import Session

from ihub_server.models import LLM, LLMCreate, LLMUpdate
from ihub_server.repositories import llm as llm_repository
from ihub_server.services.errors import NotFoundError


class LLMService:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_llms(self, offset: int, limit: int, project_id: UUID | None = None) -> list[LLM]:
        return llm_repository.list_llms(self._session, offset, limit, project_id)

    def get_llm(self, llm_id: int) -> LLM:
        llm = llm_repository.get_llm(self._session, llm_id)
        if not llm:
            msg = "LLM not found."
            raise NotFoundError(msg)
        return llm

    def create_llm(self, llm: LLMCreate) -> LLM:
        return llm_repository.create_llm(self._session, llm)

    def update_llm(self, llm_id: int, updates: LLMUpdate) -> LLM:
        llm = llm_repository.get_llm(self._session, llm_id)
        if not llm:
            msg = "LLM not found."
            raise NotFoundError(msg)
        return llm_repository.update_llm(self._session, llm, updates)

    def delete_llm(self, llm_id: int) -> None:
        llm = llm_repository.get_llm(self._session, llm_id)
        if not llm:
            msg = "LLM not found."
            raise NotFoundError(msg)
        llm_repository.delete_llm(self._session, llm)
