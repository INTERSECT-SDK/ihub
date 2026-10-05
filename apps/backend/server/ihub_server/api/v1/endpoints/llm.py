"""CRUD endpoints for LLM."""

from typing import TYPE_CHECKING, Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ihub_server.api.deps import PrincipalDep, get_llm_service
from ihub_server.models import LLMCreate, LLMPublic, LLMUpdate
from ihub_server.services.errors import NotFoundError

if TYPE_CHECKING:
    from ihub_server.services.llm import LLMService

router = APIRouter()

llm_service_dep = Depends(get_llm_service)


@router.get(
    "/",
    tags=["LLM"],
    description="Get list of LLMs.",
    response_description="List of LLMs",
    response_model=list[LLMPublic],
)
def read_llm(
    _principal: PrincipalDep,
    llm_service: "LLMService" = llm_service_dep,
    offset: int = 0,
    limit: Annotated[int, Query(le=100)] = 100,
    project_id: UUID | None = None,
):
    """
    Query database and return list of known brokers.
    """
    return llm_service.list_llms(offset, limit, project_id)


@router.post(
    "/",
    tags=["LLM"],
    description="Add a new LLM.",
    response_description="The created LLM.",
    response_model=LLMPublic,
)
def create_llm(
    llm: LLMCreate,
    _principal: PrincipalDep,
    llm_service: "LLMService" = llm_service_dep,
):
    """
    Add a new LLM to the database.
    """
    return llm_service.create_llm(llm)


@router.delete(
    "/{llm_id}",
    tags=["LLM"],
    description="Delete a LLM.",
)
def delete_llm(
    llm_id: int,
    _principal: PrincipalDep,
    llm_service: "LLMService" = llm_service_dep,
):
    """
    Delete a LLM from the database.
    """
    try:
        llm_service.delete_llm(llm_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"detail": "LLM deleted."}


@router.patch(
    "/{llm_id}",
    tags=["LLM"],
    description="Update a LLM.",
    response_description="The updated LLM.",
    response_model=LLMPublic,
)
def update_llm(
    llm_id: int,
    llm_update: LLMUpdate,
    _principal: PrincipalDep,
    llm_service: "LLMService" = llm_service_dep,
):
    """
    Update a LLM in the database.
    """
    try:
        return llm_service.update_llm(llm_id, llm_update)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


class ChatFeed(BaseModel):
    """Chat messages to feed to LLM"""

    messages: list[list[str]]  # [[role, message]]
