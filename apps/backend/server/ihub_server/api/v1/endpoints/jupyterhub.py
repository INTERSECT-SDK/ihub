"""CRUD endpoints for jupyter hub"""

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException

from ihub_server.api.deps import PrincipalDep, get_jupyterhub_service
from ihub_server.services.errors import ServiceError

router = APIRouter()

jupyterhub_service_dep = Depends(get_jupyterhub_service)

if TYPE_CHECKING:
    from ihub_server.services.jupyterhub import JupyterHubService

# /hub/api/users/test-1/server/progress


def _canonical_jupyter_user(user_id: str, principal: PrincipalDep) -> str:
    """Authorize a JupyterHub path identity against the current iHub caller."""
    canonical_email = principal.email
    if user_id.strip().casefold() != canonical_email.casefold():
        raise HTTPException(
            status_code=403,
            detail="JupyterHub user does not match the authenticated user",
        )
    return canonical_email


@router.get(
    "/{user_id}/server",
    tags=["Jupyter Hub"],
    description="Get the list of jupyter servers for the user.",
    response_description="List of jupyter servers for the user",
    # response_model=JupyterPublic,
)
async def list_user_server(
    user_id: str,
    principal: PrincipalDep,
    jupyterhub_service: "JupyterHubService" = jupyterhub_service_dep,
):
    """
    Use JupyterHub API to get a list of user servers.
    """
    jupyter_user = _canonical_jupyter_user(user_id, principal)
    try:
        return await jupyterhub_service.list_user_servers(jupyter_user)
    except ServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{user_id}/server",
    tags=["Jupyter Hub"],
    description="Start a single user jupyter server for the user.",
    response_description="Single jupyter server for the user",
    # response_model=JupyterPublic,
)
async def start_user_server(
    user_id: str,
    principal: PrincipalDep,
    jupyterhub_service: "JupyterHubService" = jupyterhub_service_dep,
):
    """
    Use JupyterHub API to start single user server for the user.
    """
    jupyter_user = _canonical_jupyter_user(user_id, principal)
    try:
        return await jupyterhub_service.start_user_server(jupyter_user)
    except ServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{user_id}/token",
    tags=["Jupyter Hub"],
    description="Create an access token for the user server.",
    response_description="Access token for the user server",
    # response_model=JupyterPublic,
)
async def create_user_token(
    user_id: str,
    principal: PrincipalDep,
    jupyterhub_service: "JupyterHubService" = jupyterhub_service_dep,
):
    """
    Use JupyterHub API to create access token for the user server.
    """
    jupyter_user = _canonical_jupyter_user(user_id, principal)
    try:
        return await jupyterhub_service.create_user_token(jupyter_user)
    except ServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
