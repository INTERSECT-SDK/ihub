"""Authentication helpers for Keycloak OAuth flows and session tokens."""

import secrets
from collections.abc import Mapping
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
import jwt
from authlib.integrations.base_client.errors import MismatchingStateError, OAuthError
from authlib.integrations.starlette_client import OAuth
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from redis.commands.json.path import Path
from sqlmodel import Session
from starlette.config import Config

from ihub_server.core.environment import settings
from ihub_server.models import LoginAuditLog, LoginEventType
from ihub_server.repositories import auth_audit as auth_audit_repository

oauth_config = Config(environ={})
oauth_session = OAuth(oauth_config)
oauth_session.register(
    "keycloak",
    authorize_url=settings.keycloak_authorize_url,
    access_token_url=settings.keycloak_token_url,
    scope=settings.SCOPE,
    client_id=settings.CLIENT_ID,
    client_secret=settings.CLIENT_SECRET,
    jwks_uri=settings.keycloak_jwks_url,
)


def _use_secure_cookie() -> bool:
    """Return whether auth cookies should be marked secure for the callback URL."""
    return settings.OAUTH_CALLBACK_URL.lower().startswith("https://")


class AuthService:
    """Coordinate OAuth, development bypass, user sessions, and audit logging."""

    def __init__(self, session: Session) -> None:
        """Create an auth service backed by the provided database session."""
        self._session = session

    async def login_redirect(self, request: Request) -> RedirectResponse:
        """Start login by redirecting to Keycloak or creating a dev bypass session."""
        if self._is_dev_bypass_enabled():
            return await self._create_dev_session_and_redirect(request)

        callback_url = settings.OAUTH_CALLBACK_URL or request.url_for("login_callback")
        if not callback_url:
            raise HTTPException(status_code=500, detail="Failed to generate callback URL")
        return await oauth_session.keycloak.authorize_redirect(request, callback_url)

    async def login_callback(self, request: Request) -> RedirectResponse:
        """Handle the OAuth callback, persist session data, and audit the result."""
        if self._is_dev_bypass_enabled():
            return await self._create_dev_session_and_redirect(request)

        request_ip = self._get_client_ip(request)
        request_user_agent = self._get_user_agent(request)

        try:
            tokens = await oauth_session.keycloak.authorize_access_token(request)
        except MismatchingStateError as exc:
            self._log_auth_event(
                event_type=LoginEventType.LOGIN_FAILURE,
                subject_id=None,
                email=None,
                ip_address=request_ip,
                user_agent=request_user_agent,
            )
            raise HTTPException(
                status_code=401,
                detail="OAuth state mismatch. Please retry login and ensure browser cookies are enabled.",
            ) from exc
        except OAuthError as exc:
            self._log_auth_event(
                event_type=LoginEventType.LOGIN_FAILURE,
                subject_id=None,
                email=None,
                ip_address=request_ip,
                user_agent=request_user_agent,
            )
            raise HTTPException(
                status_code=401,
                detail=f"OAuth callback failed: {exc}",
            ) from exc

        userinfo = await self._fetch_userinfo(tokens.get("access_token"))

        claims = userinfo or self._decode_token_claims(tokens.get("id_token"))
        email = self._extract_normalized_email(claims)
        redirect_email = self._extract_redirect_email(claims)
        subject_id = self._extract_subject_id(claims)

        if not email:
            self._log_auth_event(
                event_type=LoginEventType.LOGIN_FAILURE,
                subject_id=subject_id,
                email=None,
                ip_address=request_ip,
                user_agent=request_user_agent,
            )
            return self._redirect_unauthorized(
                reason="missing_email",
                email=redirect_email,
            )

        if not self._is_email_authorized(email):
            self._log_auth_event(
                event_type=LoginEventType.LOGIN_FAILURE,
                subject_id=subject_id,
                email=email,
                ip_address=request_ip,
                user_agent=request_user_agent,
            )
            return self._redirect_unauthorized(
                reason="not_authorized",
                email=email or redirect_email,
            )

        session_info = {
            "id_token": tokens["id_token"],
            "access_token": tokens["access_token"],
            "refresh_token": tokens["refresh_token"],
            "email": email,
            "subject_id": subject_id,
            "claims": claims,
            "role": "user",
        }
        generated_session_id = secrets.token_urlsafe(32)
        request.session["session_id"] = generated_session_id
        await request.app.state.redis.json().set(
            generated_session_id,
            Path.root_path(),
            session_info,
        )
        response = RedirectResponse(settings.OAUTH_REDIRECT_URL, status_code=303)
        response.set_cookie(
            key="IHUB_SESSION",
            value=generated_session_id,
            secure=_use_secure_cookie(),
            httponly=True,
            samesite="lax",
            max_age=60 * 60 * 24 * 7,
        )
        self._log_auth_event(
            event_type=LoginEventType.LOGIN_SUCCESS,
            subject_id=subject_id,
            email=email,
            ip_address=request_ip,
            user_agent=request_user_agent,
        )
        return response

    def user_info(self, user: dict | None) -> JSONResponse:
        """Return normalized user profile information for the active session."""
        if user is None:
            msg = "User session not found"
            raise HTTPException(status_code=401, detail=msg)

        if self._is_dev_bypass_enabled() and user.get("auth_mode") == "dev_bypass":
            full_name = str(user.get("name") or "").strip()
            name_parts = [part for part in full_name.split(" ") if part]
            first_name = name_parts[0] if name_parts else "Dev"
            last_name = " ".join(name_parts[1:]) if len(name_parts) > 1 else "User"
            email = str(user.get("email") or "").strip().lower()
            username = email.split("@")[0] if email and "@" in email else email

            dev_user_info = {
                "sub": user.get("subject_id"),
                "email": email,
                "name": full_name or f"{first_name} {last_name}",
                "given_name": first_name,
                "family_name": last_name,
                "preferred_username": username,
                "auth_mode": "dev_bypass",
                "role": "user",
                "exp": "",
            }
            return JSONResponse(content=dev_user_info)

        claims = self._extract_user_claims(user)

        normalized_user_info = {
            "sub": claims.get("sub") or self._extract_subject_id(user),
            "email": self._extract_normalized_email(claims) or self._extract_normalized_email(user),
            "name": claims.get("name") or "",
            "given_name": claims.get("given_name") or "",
            "family_name": claims.get("family_name") or "",
            "preferred_username": claims.get("preferred_username") or claims.get("nickname") or "",
            "role": "user",
            "exp": claims.get("exp") or "",
        }

        if not normalized_user_info["preferred_username"] and normalized_user_info["email"]:
            normalized_user_info["preferred_username"] = str(normalized_user_info["email"]).split(
                "@"
            )[0]

        if not normalized_user_info["given_name"] or not normalized_user_info["family_name"]:
            full_name = str(normalized_user_info["name"] or "").strip()
            name_parts = [part for part in full_name.split(" ") if part]
            if name_parts and not normalized_user_info["given_name"]:
                normalized_user_info["given_name"] = name_parts[0]
            if len(name_parts) > 1 and not normalized_user_info["family_name"]:
                normalized_user_info["family_name"] = " ".join(name_parts[1:])

        if not normalized_user_info["given_name"]:
            normalized_user_info["given_name"] = (
                normalized_user_info["preferred_username"] or "User"
            )
        if not normalized_user_info["family_name"]:
            normalized_user_info["family_name"] = "User"

        return JSONResponse(content=normalized_user_info)

    async def logout(self, request: Request) -> JSONResponse:
        """Clear user session from Redis and return response with cleared cookie."""
        session_id = request.cookies.get("IHUB_SESSION")
        request_ip = self._get_client_ip(request)
        request_user_agent = self._get_user_agent(request)

        subject_id: str | None = None
        email: str | None = None

        if session_id:
            session_info = await request.app.state.redis.json().get(session_id)
            if isinstance(session_info, Mapping):
                email = self._extract_normalized_email(session_info)
                subject_id = self._extract_subject_id(session_info)
            await request.app.state.redis.delete(session_id)

        self._log_auth_event(
            event_type=LoginEventType.LOGOUT,
            subject_id=subject_id,
            email=email,
            ip_address=request_ip,
            user_agent=request_user_agent,
        )

        response = JSONResponse({"message": "Logged out successfully"})
        response.delete_cookie(
            key="IHUB_SESSION",
            secure=_use_secure_cookie(),
            httponly=True,
            samesite="lax",
        )
        return response

    def _is_email_authorized(self, email: str) -> bool:
        """Return whether the normalized email belongs to an active authorized user."""
        return (
            auth_audit_repository.get_active_authorized_user_by_email(self._session, email)
            is not None
        )

    async def _fetch_userinfo(self, access_token: str | None) -> dict[str, Any]:
        """Fetch user profile claims from the configured OAuth userinfo endpoint."""
        if not access_token or not hasattr(settings, "OAUTH_USERDATA_URL"):
            return {}

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    settings.OAUTH_USERDATA_URL,
                    headers={"Authorization": f"Bearer {access_token}"},
                    timeout=10.0,
                )
                if response.status_code == 200:
                    body = response.json()
                    return body if isinstance(body, dict) else {}
        except (httpx.HTTPError, ValueError):
            return {}

        return {}

    def _extract_user_claims(self, user: Mapping[str, Any] | dict[str, Any]) -> dict[str, Any]:
        """Return cached claims or decode them from the stored ID token."""
        cached_claims = user.get("claims")
        if isinstance(cached_claims, dict):
            return cached_claims

        token = user.get("id_token")
        decoded_claims = self._decode_token_claims(token)
        return decoded_claims if isinstance(decoded_claims, dict) else {}

    @staticmethod
    def _redirect_unauthorized(*, reason: str, email: str | None) -> RedirectResponse:
        """Build the unauthorized-login redirect URL with safe query parameters."""
        redirect_base = settings.OAUTH_UNAUTHORIZED_REDIRECT_URL
        split_url = urlsplit(redirect_base)
        query_items = dict(parse_qsl(split_url.query))
        query_items["reason"] = reason
        if email:
            query_items["email"] = email
        redirect_url = urlunsplit(
            (
                split_url.scheme,
                split_url.netloc,
                split_url.path,
                urlencode(query_items),
                split_url.fragment,
            )
        )
        return RedirectResponse(redirect_url, status_code=303)

    @staticmethod
    def _is_dev_bypass_enabled() -> bool:
        """Return whether local development authentication bypass is enabled."""
        auth_mode = getattr(settings, "AUTH_MODE", "oauth")
        environment = getattr(settings, "ENVIRONMENT", "development")
        return auth_mode == "dev_bypass" and environment == "development"

    async def _create_dev_session_and_redirect(self, request: Request) -> RedirectResponse:
        """Create a configured development user session and redirect to the app."""
        request_ip = self._get_client_ip(request)
        request_user_agent = self._get_user_agent(request)

        email = str(getattr(settings, "DEV_AUTH_EMAIL", "dev.user@example.com")).strip().lower()
        name = str(getattr(settings, "DEV_AUTH_NAME", "Local Dev User")).strip()
        subject_id = f"dev-bypass:{email}"

        session_info = {
            "auth_mode": "dev_bypass",
            "subject_id": subject_id,
            "email": email,
            "name": name,
            "role": "user",
        }

        auth_audit_repository.ensure_authorized_user_exists(self._session, email)
        generated_session_id = secrets.token_urlsafe(32)
        request.session["session_id"] = generated_session_id
        await request.app.state.redis.json().set(
            generated_session_id,
            Path.root_path(),
            session_info,
        )

        response = RedirectResponse(settings.OAUTH_REDIRECT_URL, status_code=303)
        response.set_cookie(
            key="IHUB_SESSION",
            value=generated_session_id,
            secure=_use_secure_cookie(),
            httponly=True,
            samesite="lax",
            max_age=60 * 60 * 24 * 7,
        )

        self._log_auth_event(
            event_type=LoginEventType.LOGIN_SUCCESS,
            subject_id=subject_id,
            email=email,
            ip_address=request_ip,
            user_agent=request_user_agent,
        )

        return response

    @staticmethod
    def _decode_token_claims(id_token: Any) -> dict[str, Any]:
        """Decode JWT claims without verification for profile normalization only."""
        if not isinstance(id_token, str):
            return {}
        try:
            claims = jwt.decode(
                id_token,
                algorithms=["HS256", "RS256"],
                options={"verify_signature": False},
            )
        except jwt.PyJWTError:
            return {}
        return claims if isinstance(claims, dict) else {}

    @staticmethod
    def _extract_normalized_email(data: Mapping[str, Any] | dict[str, Any]) -> str | None:
        """Extract and lowercase the preferred email-like identity claim."""
        email_candidate = data.get("email") or data.get("preferred_username")
        if not isinstance(email_candidate, str):
            return None
        normalized_email = email_candidate.strip().lower()
        return normalized_email or None

    @staticmethod
    def _extract_subject_id(data: Mapping[str, Any] | dict[str, Any]) -> str | None:
        """Extract a stable subject identifier from session data or token claims."""
        subject = data.get("subject_id") or data.get("sub")
        if not isinstance(subject, str):
            return None
        normalized_subject = subject.strip()
        return normalized_subject or None

    @staticmethod
    def _extract_redirect_email(data: Mapping[str, Any] | dict[str, Any]) -> str | None:
        """Extract an email suitable for unauthorized redirect messaging."""
        for key in ("email", "preferred_username", "upn", "unique_name"):
            value = data.get(key)
            if not isinstance(value, str):
                continue
            normalized = value.strip().lower()
            if normalized and "@" in normalized:
                return normalized
        return None

    @staticmethod
    def _get_client_ip(request: Request) -> str | None:
        """Return the originating client IP, respecting proxy forwarding headers."""
        headers = getattr(request, "headers", None)
        x_forwarded_for = headers.get("x-forwarded-for") if headers else None
        if x_forwarded_for:
            return x_forwarded_for.split(",")[0].strip()
        client = getattr(request, "client", None)
        if client:
            return client.host
        return None

    @staticmethod
    def _get_user_agent(request: Request) -> str | None:
        """Return the request user-agent header when available."""
        headers = getattr(request, "headers", None)
        return headers.get("user-agent") if headers else None

    def _log_auth_event(
        self,
        *,
        event_type: LoginEventType,
        subject_id: str | None,
        email: str | None,
        ip_address: str | None,
        user_agent: str | None,
    ) -> None:
        """Persist an audit record for a login, logout, or failed auth attempt."""
        log_entry = LoginAuditLog(
            subject_id=subject_id,
            email=email,
            event_type=event_type,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        auth_audit_repository.create_login_audit_log(self._session, log_entry)
