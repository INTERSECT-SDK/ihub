from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from starlette import status

from ihub_server.api.deps import get_healthcheck_service
from ihub_server.services.errors import ServiceError

if TYPE_CHECKING:
    from ihub_server.services.healthcheck import HealthcheckService

router = APIRouter()

healthcheck_service_dep = Depends(get_healthcheck_service)


@router.get(
    "/healthcheck",
    tags=["Healthcheck"],
    description="Application healthcheck",
    response_description=(
        "Array of errors explaining why the service won't work (if empty array: all OK)"
    ),
    response_model=list[str],
)
async def healthcheck(
    req: Request,
    healthcheck_service: "HealthcheckService" = healthcheck_service_dep,
):
    """This can be used as a healthcheck endpoint for, e.g. Kubernetes."""
    code = status.HTTP_200_OK
    errors = []

    try:
        errors = healthcheck_service.check(req.app.state)
    except ServiceError as exc:
        errors.append(str(exc))

    if errors:
        code = status.HTTP_503_SERVICE_UNAVAILABLE

    return JSONResponse({"errors": errors}, status_code=code)
