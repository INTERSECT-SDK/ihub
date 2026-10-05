from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse

from ihub_server.api.deps import get_auth_service
from ihub_server.db import UserDep

if TYPE_CHECKING:
    from ihub_server.services.auth import AuthService

router = APIRouter()

auth_service_dep = Depends(get_auth_service)


@router.get("/")
async def login_redirect(
    request: Request,
    auth_service: "AuthService" = auth_service_dep,
) -> RedirectResponse:
    return await auth_service.login_redirect(request)


@router.get("/callback")
async def login_callback(
    request: Request,
    auth_service: "AuthService" = auth_service_dep,
) -> RedirectResponse:
    return await auth_service.login_callback(request)


@router.get("/user")
async def user_info(
    user: UserDep,
    auth_service: "AuthService" = auth_service_dep,
):
    return auth_service.user_info(user)


@router.post("/logout")
async def logout(
    request: Request,
    auth_service: "AuthService" = auth_service_dep,
):
    return await auth_service.logout(request)
