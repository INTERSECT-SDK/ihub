"""CRUD endpoints for jupyter servers"""

from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from ihub_server.api.deps import get_jupyter_server_service
from ihub_server.models import JupyterCreate, JupyterPublic, JupyterServer, JupyterUpdate
from ihub_server.services.errors import NotFoundError

if TYPE_CHECKING:
    from ihub_server.services.jupyter_servers import JupyterServerService

router = APIRouter()

jupyter_service_dep = Depends(get_jupyter_server_service)


@router.get(
    "/",
    tags=["Jupyter Servers"],
    description="Get list of jupyter servers.",
    response_description="List of jupyter servers",
    response_model=list[JupyterPublic],
)
def read_jupyter_servers(
    jupyter_service: "JupyterServerService" = jupyter_service_dep,
    offset: int = 0,
    limit: Annotated[int, Query(le=100)] = 100,
):
    """
    Query database and return list of known jupyter servers.
    """
    return jupyter_service.list_jupyter_servers(offset, limit)


@router.get(
    "/{jupyter_id}",
    tags=["Jupyter Servers"],
    description="Get a single jupyter server.",
    response_description="Single jupyter server",
    response_model=JupyterPublic,
)
def read_jupyter_server(
    jupyter_server_id: int,
    jupyter_service: "JupyterServerService" = jupyter_service_dep,
):
    """
    Query database and return single jupyter server.
    """
    try:
        return jupyter_service.get_jupyter_server(jupyter_server_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post(
    "/",
    tags=["Jupyter Servers"],
    description="Create and save jupyter server to database.",
    response_description="create jupyter server.",
    response_model=JupyterPublic,
)
def create_jupyter_server(
    jupyter_server: JupyterCreate,
    jupyter_service: "JupyterServerService" = jupyter_service_dep,
):
    """
    Create and save jupyter server to database.
    """
    return jupyter_service.create_jupyter_server(jupyter_server)


@router.patch(
    "/{jupyter_id}",
    tags=["Jupyter Servers"],
    description="Update a jupyter server.",
    response_description="update jupyter server",
    response_model=JupyterPublic,
)
def update_jupyer_server(
    jupyter_server_id: int,
    jupyter_server: JupyterUpdate,
    jupyter_service: "JupyterServerService" = jupyter_service_dep,
) -> JupyterServer:
    """
    Create and save jupyter server to database.
    """
    try:
        return jupyter_service.update_jupyter_server(jupyter_server_id, jupyter_server)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete(
    "/{jupyter_id}",
    tags=["Jupyter Servers"],
    description="Delete jupyter server from database.",
    response_description="delete jupyter server",
)
def delete_jupyter_server(
    jupyter_server_id: int,
    jupyter_service: "JupyterServerService" = jupyter_service_dep,
):
    """
    Delete jupyter server from the database.
    """
    try:
        jupyter_service.delete_jupyter_server(jupyter_server_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok", True}
