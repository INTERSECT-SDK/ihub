"""Service for JupyterHub user server lifecycle operations."""

import asyncio
import logging
import os

import httpx

from ihub_server.services.errors import ServiceError

_log = logging.getLogger("ihub-server")


def _token_ids(payload: object) -> list[str]:
    if not isinstance(payload, dict) or not isinstance(payload.get("api_tokens"), list):
        msg = "JupyterHub returned an invalid token list."
        raise ServiceError(msg)
    token_ids = [
        token.get("id") if isinstance(token, dict) else None for token in payload["api_tokens"]
    ]
    if any(not isinstance(token_id, str) or not token_id for token_id in token_ids):
        msg = "JupyterHub returned a token without an id."
        raise ServiceError(msg)
    return [token_id for token_id in token_ids if isinstance(token_id, str)]


def _raise_stop_timeout(user_id: str) -> None:
    msg = f"Timed out waiting for JupyterHub server for {user_id} to stop."
    raise ServiceError(msg)


def _has_default_server(payload: object) -> bool:
    if not isinstance(payload, dict) or not isinstance(payload.get("servers"), dict):
        msg = "JupyterHub returned an invalid user record."
        raise ServiceError(msg)
    return "" in payload["servers"]


class JupyterHubService:
    @staticmethod
    def _admin_configuration() -> tuple[str, dict[str, str]]:
        """Return the configured Hub base URL and admin authorization header."""
        jh_host = os.environ.get("JH_HOST")
        jh_admin_token = os.environ.get("JH_ADMIN_TOKEN")
        if jh_admin_token is None:
            msg = "JupyterHub admin token not set."
            raise ServiceError(msg)
        if jh_host is None:
            msg = "JupyterHub host not set."
            raise ServiceError(msg)
        return jh_host.rstrip("/"), {"Authorization": f"token {jh_admin_token}"}

    async def retire_user_access(
        self,
        user_id: str,
        *,
        stop_timeout: float = 60,
        poll_interval: float = 0.5,
    ) -> None:
        """Revoke every user token and stop the default server without deleting data."""
        jh_host, headers = self._admin_configuration()
        user_url = f"{jh_host}/hub/api/users/{user_id}"

        async with httpx.AsyncClient(headers=headers) as client:
            try:
                user_response = await client.get(user_url, timeout=30.0)
                if user_response.status_code == 404:
                    return
                user_response.raise_for_status()
                has_default_server = _has_default_server(user_response.json())

                tokens_response = await client.get(f"{user_url}/tokens", timeout=30.0)
                tokens_response.raise_for_status()
                for token_id in _token_ids(tokens_response.json()):
                    revoke_response = await client.delete(
                        f"{user_url}/tokens/{token_id}",
                        timeout=30.0,
                    )
                    revoke_response.raise_for_status()

                if not has_default_server:
                    return

                stop_response = await client.delete(f"{user_url}/server", timeout=30.0)
                stop_response.raise_for_status()
                deadline = asyncio.get_running_loop().time() + stop_timeout
                while True:
                    status_response = await client.get(user_url, timeout=30.0)
                    if status_response.status_code == 404:
                        return
                    status_response.raise_for_status()
                    if not _has_default_server(status_response.json()):
                        return
                    if asyncio.get_running_loop().time() >= deadline:
                        _raise_stop_timeout(user_id)
                    await asyncio.sleep(poll_interval)
            except ServiceError:
                raise
            except (ValueError, httpx.HTTPStatusError, httpx.RequestError) as exc:
                msg = f"Failed to retire JupyterHub access for {user_id}: {exc}"
                raise ServiceError(msg) from exc

    async def ensure_user_exists(self, user_id: str):
        """Ensure user exists in JupyterHub, create if not."""
        jh_host = os.environ.get("JH_HOST")
        jh_admin_token = os.environ.get("JH_ADMIN_TOKEN")
        if jh_admin_token is None:
            msg = "JupyterHub admin token not set."
            raise ServiceError(msg)

        if jh_host is None:
            msg = "JupyterHub host not set."
            raise ServiceError(msg)

        headers = {"Authorization": f"token {jh_admin_token}"}
        async with httpx.AsyncClient() as client:
            try:
                # Check if user exists
                response = await client.get(
                    f"{jh_host}/hub/api/users/{user_id}",
                    headers=headers,
                    timeout=30.0,
                )
                response.raise_for_status()
                _log.info("User %s already exists in JupyterHub.", user_id)
            except httpx.HTTPStatusError as err:
                status_code = err.response.status_code if err.response is not None else None
                if status_code == 404:
                    # User doesn't exist, create them
                    try:
                        create_response = await client.post(
                            f"{jh_host}/hub/api/users/{user_id}",
                            headers=headers,
                            timeout=30.0,
                        )
                        create_response.raise_for_status()
                        _log.info("User %s created in JupyterHub.", user_id)
                    except httpx.HTTPStatusError as create_err:
                        msg = f"Error creating user. Error Details: {create_err}"
                        raise ServiceError(msg) from create_err
                else:
                    msg = f"Error checking user existence. Error Details: {err}"
                    raise ServiceError(msg) from err

    async def list_user_servers(self, user_id: str):
        # Ensure user exists first
        await self.ensure_user_exists(user_id)

        jh_host = os.environ.get("JH_HOST")
        jh_admin_token = os.environ.get("JH_ADMIN_TOKEN")
        if jh_admin_token is None:
            msg = "JupyterHub admin token not set."
            raise ServiceError(msg)

        if jh_host is None:
            msg = "JupyterHub host not set."
            raise ServiceError(msg)

        headers = {"Authorization": f"token {jh_admin_token}"}
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{jh_host}/hub/api/users/{user_id}",
                    headers=headers,
                    timeout=30.0,
                )
                response.raise_for_status()
                return response.json().get("servers", {})
            except httpx.HTTPStatusError as err:
                msg = f"Error fetching user servers. Error Details: {err}"
                raise ServiceError(msg) from err

    async def start_user_server(self, user_id: str):
        # Ensure user exists first
        await self.ensure_user_exists(user_id)

        jh_host = os.environ.get("JH_HOST")
        jh_admin_token = os.environ.get("JH_ADMIN_TOKEN")
        if jh_admin_token is None:
            msg = "JupyterHub admin token not set."
            raise ServiceError(msg)

        if jh_host is None:
            msg = "JupyterHub host not set."
            raise ServiceError(msg)

        headers = {"Authorization": f"token {jh_admin_token}"}

        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{jh_host}/hub/api/users/{user_id}/server",
                    headers=headers,
                    timeout=30.0,
                )
                response.raise_for_status()
            except httpx.HTTPStatusError as err:
                msg = f"Error starting a server. Error Details: {err}"
                raise ServiceError(msg) from err

        _log.info("Server started for user %s in JupyterHub.", user_id)

        timeout = 60
        poll_interval = 0.5
        deadline = asyncio.get_event_loop().time() + timeout

        async with httpx.AsyncClient(headers=headers) as client:
            while True:
                resp = await client.get(f"{jh_host}/hub/api/users/{user_id}")
                resp.raise_for_status()
                data = resp.json()

                server = data.get("servers", {}).get("")

                if server:
                    if server.get("ready"):
                        return server

                    if server.get("pending") is None and not server.get("ready"):
                        msg = "Server failed to start"
                        raise ServiceError(msg)

                if asyncio.get_event_loop().time() > deadline:
                    msg = "Timed out waiting for server"
                    raise ServiceError(msg)

                await asyncio.sleep(poll_interval)

    async def create_user_token(self, user_id: str):
        # Ensure user exists first
        await self.ensure_user_exists(user_id)

        jh_host = os.environ.get("JH_HOST")
        jh_admin_token = os.environ.get("JH_ADMIN_TOKEN")

        async with httpx.AsyncClient() as client:
            headers = {
                "Authorization": f"token {jh_admin_token}",
                "Content-Type": "application/json",
            }
            data = {
                "note": f"Token created via iHub API for user {user_id}",
                "scopes": [f"access:servers!user={user_id}"],
            }
            try:
                response = await client.post(
                    f"{jh_host}/hub/api/users/{user_id}/tokens",
                    headers=headers,
                    json=data,
                )
                response.raise_for_status()
            except httpx.HTTPStatusError as err:
                msg = f"Error creating a token. Error Details: {err}"
                raise ServiceError(msg) from err

        _log.info("Token created for user %s in JupyterHub.", user_id)
        return response.json()

    async def create_user_token_if_exists(self, user_id: str):
        """Create a user token only when the JupyterHub user already exists."""
        jh_host = os.environ.get("JH_HOST")
        jh_admin_token = os.environ.get("JH_ADMIN_TOKEN")
        if jh_admin_token is None or jh_host is None:
            _log.warning("Skipping Jupyter token lookup because JupyterHub is not configured.")
            return None

        headers = {
            "Authorization": f"token {jh_admin_token}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient() as client:
            try:
                user_response = await client.get(
                    f"{jh_host}/hub/api/users/{user_id}",
                    headers=headers,
                    timeout=30.0,
                )
                user_response.raise_for_status()
            except httpx.HTTPStatusError as err:
                status_code = err.response.status_code if err.response is not None else None
                if status_code == 404:
                    _log.info("JupyterHub user %s was not found for token lookup.", user_id)
                    return None
                _log.warning("Failed to check JupyterHub user %s for token lookup.", user_id)
                return None
            except httpx.RequestError:
                _log.warning("Failed to reach JupyterHub while checking user %s.", user_id)
                return None

            data = {
                "note": f"Token created via iHub API for user {user_id}",
                "scopes": [f"access:servers!user={user_id}"],
            }
            try:
                token_response = await client.post(
                    f"{jh_host}/hub/api/users/{user_id}/tokens",
                    headers=headers,
                    json=data,
                )
                token_response.raise_for_status()
                return token_response.json()
            except (ValueError, httpx.HTTPStatusError, httpx.RequestError):
                _log.warning("Failed to create Jupyter token for user %s.", user_id)
                return None
