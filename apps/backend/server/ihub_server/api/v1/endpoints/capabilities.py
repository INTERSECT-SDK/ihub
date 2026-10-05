"""CRUD endpoints for INTERSECT capabilites"""

from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from ihub_server.api.deps import get_capability_service
from ihub_server.models import CapabilityPublic
from ihub_server.services.errors import NotFoundError

if TYPE_CHECKING:
    from ihub_server.services.capabilities import CapabilityService

router = APIRouter()

capability_service_dep = Depends(get_capability_service)


@router.get(
    "/",
    tags=["Capabilities"],
    description="Get list of INTERSECT Services.",
    response_description="List of INTERSECT Services",
    response_model=list[CapabilityPublic],
)
def read_capabilities(
    capability_service: "CapabilityService" = capability_service_dep,
    service_id: int | None = None,
    offset: int = 0,
    limit: Annotated[int, Query(le=100)] = 100,
):
    """
    Query list of capabilities from database.
    """
    # No Filter
    if not service_id:
        return capability_service.list_capabilities(offset, limit)

    # Filters capabilites by service id
    return capability_service.list_capabilities_for_service(service_id, offset, limit)


@router.get(
    "/{service_id}",
    tags=["Capabilities"],
    description="Get a list of capabilities for a service.",
    response_description="List of capabilities",
    response_model=list[CapabilityPublic],
)
def read_capabilities_by_service(
    service_id: int,
    capability_service: "CapabilityService" = capability_service_dep,
):
    """
    Query capabilities for a specific service from database.
    """
    return capability_service.list_capabilities_for_service(service_id, 0, 100)


@router.get(
    "/capability/{capability_id}",
    tags=["Capabilities"],
    description="Get a single capability.",
    response_description="Single capability",
    response_model=CapabilityPublic,
)
def read_capability(
    capability_id: int,
    capability_service: "CapabilityService" = capability_service_dep,
):
    """
    Query capability from database.
    """
    try:
        return capability_service.get_capability(capability_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
