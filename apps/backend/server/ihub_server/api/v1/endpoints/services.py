"""CRUD endpoints for INTERSECT services."""

from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from ihub_server.api.deps import get_service_service
from ihub_server.models import ServicePublic
from ihub_server.services.errors import NotFoundError

if TYPE_CHECKING:
    from ihub_server.services.services import ServiceService

router = APIRouter()

service_service_dep = Depends(get_service_service)


@router.get(
    "/",
    tags=["Services"],
    description="Get list of INTERSECT Services.",
    response_description="List of INTERSECT Services",
    response_model=list[ServicePublic],
)
def read_services(
    service_service: "ServiceService" = service_service_dep,
    offset: int = 0,
    limit: Annotated[int, Query(le=100)] = 100,
):
    """
    Query list of services from database.
    """
    return service_service.list_services(offset, limit)


@router.get(
    "/{broker_id}",
    tags=["Services"],
    description="Get list of INTERSECT services on a given broker.",
    response_description="List of INTERSECT Services on Broker",
    response_model=list[ServicePublic],
)
def read_services_for_broker(
    broker_id: int,
    service_service: "ServiceService" = service_service_dep,
):
    """
    Query list of services for a given broker from database.
    """
    services = service_service.list_services_for_broker(broker_id)
    if not services:
        raise HTTPException(status_code=404, detail="Services not found for broker")
    return services


@router.get(
    "/service/{service_id}",
    tags=["Services"],
    description="Get a single service on a given broker.",
    response_description="Single service on Broker",
    response_model=ServicePublic,
)
def read_service(
    service_id: int,
    service_service: "ServiceService" = service_service_dep,
):
    """
    Query service from database.
    """
    try:
        return service_service.get_service(service_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
