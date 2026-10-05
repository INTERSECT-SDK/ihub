"""Service for proxying JupyterHub contents operations."""

import json
import logging
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote, unquote, urljoin, urlsplit, urlunsplit

import httpx

from ihub_server.services.errors import (
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ServiceError,
    UnauthorizedError,
    UpstreamServiceError,
)

_log = logging.getLogger("ihub-server")


@dataclass
class JupyterFileStream:
    """Own an upstream raw-file response and its HTTP client."""

    response: httpx.Response
    client: httpx.AsyncClient
    _closed: bool = field(default=False, init=False)

    @property
    def content_type(self) -> str | None:
        """Return the upstream media type when one was supplied."""
        return self.response.headers.get("Content-Type")

    @property
    def content_length(self) -> str | None:
        """Return the upstream byte length when one was supplied."""
        return self.response.headers.get("Content-Length")

    async def iter_raw(self) -> AsyncIterator[bytes]:
        """Yield undecoded upstream chunks and release owned resources."""
        try:
            async for chunk in self.response.aiter_raw():
                yield chunk
        finally:
            await self.aclose()

    async def aclose(self) -> None:
        """Close both the streaming response and its owning client."""
        if self._closed:
            return

        self._closed = True
        await self.response.aclose()
        await self.client.aclose()


class ContentService:
    async def read_content(
        self,
        base_url: str,
        path: str,
        jupyter_user: str,
        jupyter_token: str,
        *,
        query: Mapping[str, str] | None = None,
    ) -> dict[str, Any]:
        """Fetch a file or directory entry from the upstream Jupyter contents API."""
        return await self._request_contents(
            "GET",
            base_url,
            path,
            jupyter_user,
            jupyter_token,
            params=query,
        )

    async def save_content(
        self,
        base_url: str,
        path: str,
        content: Mapping[str, Any],
        jupyter_user: str,
        jupyter_token: str,
    ) -> dict[str, Any]:
        """Create or update a Jupyter contents resource at the provided path."""
        return await self._request_contents(
            "PUT",
            base_url,
            path,
            jupyter_user,
            jupyter_token,
            json=content,
        )

    async def delete_content(
        self,
        base_url: str,
        path: str,
        jupyter_user: str,
        jupyter_token: str,
    ) -> dict[str, Any]:
        """Delete a file or directory from the upstream Jupyter contents API."""
        return await self._request_contents(
            "DELETE",
            base_url,
            path,
            jupyter_user,
            jupyter_token,
        )

    async def rename_content(
        self,
        base_url: str,
        path: str,
        new_path: str,
        jupyter_user: str,
        jupyter_token: str,
    ) -> dict[str, Any]:
        """Rename a Jupyter contents resource without moving its parent directory."""
        validated_new_path = self._validate_contents_path(new_path)
        is_chat_file = path.lower().endswith(".ichat")
        source_metadata = await self.read_content(
            base_url,
            path,
            jupyter_user,
            jupyter_token,
            query={"content": "0"},
        )
        self._validate_rename_source(source_metadata)

        if not is_chat_file:
            return await self._rename_contents_resource(
                base_url,
                path,
                validated_new_path,
                jupyter_user,
                jupyter_token,
            )

        source_content = await self.read_content(
            base_url,
            path,
            jupyter_user,
            jupyter_token,
        )
        new_filename = validated_new_path.rsplit("/", 1)[-1]
        updated_content = self._build_renamed_ichat_content(
            source_content,
            new_filename,
        )
        document_type = "Chat"
        renamed_content = await self._rename_contents_resource(
            base_url,
            path,
            validated_new_path,
            jupyter_user,
            jupyter_token,
        )

        try:
            await self.save_content(
                base_url,
                validated_new_path,
                updated_content,
                jupyter_user,
                jupyter_token,
            )
        except ServiceError:
            try:
                await self._rename_contents_resource(
                    base_url,
                    validated_new_path,
                    path,
                    jupyter_user,
                    jupyter_token,
                )
            except ServiceError as rollback_error:
                _log.exception(
                    "Failed to restore %s after its embedded name update failed.",
                    path,
                    exc_info=rollback_error,
                )
                msg = (
                    f"{document_type} file was renamed, but its embedded name could not be "
                    "updated. Refresh the file list before retrying."
                )
                raise UpstreamServiceError(msg) from rollback_error
            raise

        return renamed_content

    def _validate_rename_source(self, source_content: Mapping[str, Any]) -> None:
        """Require a file model and reject an explicitly read-only source."""
        if source_content.get("type") != "file":
            msg = "Only project files can be renamed."
            raise BadRequestError(msg)
        if source_content.get("writable") is False:
            msg = "Source file is not writable."
            raise ForbiddenError(msg)

    async def _rename_contents_resource(
        self,
        base_url: str,
        path: str,
        new_path: str,
        jupyter_user: str,
        jupyter_token: str,
    ) -> dict[str, Any]:
        """Forward one path-only rename to the Jupyter contents API."""
        return await self._request_contents(
            "PATCH",
            base_url,
            path,
            jupyter_user,
            jupyter_token,
            json={"path": new_path},
        )

    def _build_renamed_ichat_content(
        self,
        source_content: Mapping[str, Any],
        new_filename: str,
    ) -> dict[str, Any]:
        """Validate an ICHAT document and update its embedded chat name."""
        if (
            source_content.get("type") != "file"
            or source_content.get("format") != "text"
            or not isinstance(source_content.get("content"), str)
        ):
            msg = "The chat file does not contain supported text content."
            raise BadRequestError(msg)

        try:
            chat_data = json.loads(source_content["content"])
        except (TypeError, json.JSONDecodeError) as exc:
            msg = "The chat file does not contain valid JSON."
            raise BadRequestError(msg) from exc

        if (
            not isinstance(chat_data, dict)
            or not isinstance(chat_data.get("chatName"), str)
            or not isinstance(chat_data.get("participants"), list)
            or not isinstance(chat_data.get("messages"), list)
        ):
            msg = "The chat file does not contain a supported chat document."
            raise BadRequestError(msg)

        chat_data["chatName"] = new_filename
        return {
            "type": "file",
            "format": "text",
            "content": json.dumps(chat_data, indent=2, ensure_ascii=False),
        }

    async def get_files(
        self,
        base_url: str,
        project: str,
        jupyter_user: str,
        jupyter_token: str,
    ) -> dict[str, Any]:
        """Return the contents listing for a project path."""
        return await self._request_contents(
            "GET",
            base_url,
            project,
            jupyter_user,
            jupyter_token,
        )

    async def stream_file(
        self,
        base_url: str,
        path: str,
        jupyter_user: str,
        jupyter_token: str,
    ) -> JupyterFileStream:
        """Open a raw file response from the upstream Jupyter user server."""
        url = self.build_files_url(base_url, jupyter_user, path)
        headers = {
            "Accept-Encoding": "identity",
            "Authorization": f"Bearer {jupyter_token}",
        }
        client = httpx.AsyncClient(timeout=httpx.Timeout(5.0, read=None))

        try:
            request = client.build_request("GET", url, headers=headers)
            response = await client.send(request, stream=True)
            response.raise_for_status()
        except httpx.HTTPStatusError as err:
            await err.response.aclose()
            await client.aclose()
            self._raise_service_error(err)
        except httpx.RequestError as err:
            await client.aclose()
            msg = "Error requesting upstream Jupyter contents service."
            raise UpstreamServiceError(msg) from err

        _log.info("GET %s streamed from Jupyter files.", path)
        return JupyterFileStream(response=response, client=client)

    def build_contents_url(self, base_url: str, jupyter_user: str, path: str) -> str:
        """Build the upstream contents URL for either a Hub or user-server base URL."""
        validated_path = self._validate_contents_path(path)
        encoded_user = quote(jupyter_user, safe="@")
        encoded_path = quote(validated_path, safe="/")
        base_url_without_trailing_slash = base_url.rstrip("/")
        if self._is_user_server_base_url(base_url_without_trailing_slash, jupyter_user):
            base_url_without_trailing_slash = self._canonical_user_server_base_url(
                base_url_without_trailing_slash,
                jupyter_user,
            )
            return urljoin(
                f"{base_url_without_trailing_slash}/",
                f"api/contents/{encoded_path}",
            )

        upstream_path = f"user/{encoded_user}/api/contents/{encoded_path}"
        return urljoin(f"{base_url_without_trailing_slash}/", upstream_path)

    def build_files_url(self, base_url: str, jupyter_user: str, path: str) -> str:
        """Build a raw-file URL for either a Hub or user-server base URL."""
        validated_path = self._validate_contents_path(path)
        encoded_user = quote(jupyter_user, safe="@")
        encoded_path = quote(validated_path, safe="/")
        base_url_without_trailing_slash = base_url.rstrip("/")
        if self._is_user_server_base_url(base_url_without_trailing_slash, jupyter_user):
            base_url_without_trailing_slash = self._canonical_user_server_base_url(
                base_url_without_trailing_slash,
                jupyter_user,
            )
            return urljoin(
                f"{base_url_without_trailing_slash}/",
                f"files/{encoded_path}",
            )

        upstream_path = f"user/{encoded_user}/files/{encoded_path}"
        return urljoin(f"{base_url_without_trailing_slash}/", upstream_path)

    def _validate_contents_path(self, path: str) -> str:
        """Reject absolute paths and dot segments before forwarding to Jupyter."""
        if path.startswith("/"):
            msg = "Invalid contents path: absolute paths and dot segments are not allowed."
            raise BadRequestError(msg)

        if any(segment in {".", ".."} for segment in path.split("/")):
            msg = "Invalid contents path: absolute paths and dot segments are not allowed."
            raise BadRequestError(msg)

        return path

    def _is_user_server_base_url(self, base_url: str, jupyter_user: str) -> bool:
        """Return whether the base URL already points at the target user's server."""
        path_parts = urlsplit(base_url).path.strip("/").split("/")
        for index, path_part in enumerate(path_parts[:-1]):
            if path_part == "user" and unquote(path_parts[index + 1]) == jupyter_user:
                return True

        return False

    def _canonical_user_server_base_url(self, base_url: str, jupyter_user: str) -> str:
        """Keep the user-server base URL aligned with JupyterHub's user path."""
        split_url = urlsplit(base_url)
        path_parts = split_url.path.split("/")
        for index, path_part in enumerate(path_parts[:-1]):
            if path_part == "user" and unquote(path_parts[index + 1]) == jupyter_user:
                path_parts[index + 1] = quote(jupyter_user, safe="@")
                return urlunsplit(
                    split_url._replace(path="/".join(path_parts)),
                )

        return base_url

    async def _request_contents(
        self,
        method: str,
        base_url: str,
        path: str,
        jupyter_user: str,
        jupyter_token: str,
        *,
        params: Mapping[str, str] | None = None,
        json: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Send a contents request upstream and translate transport failures."""
        url = self.build_contents_url(base_url, jupyter_user, path)
        headers = {"Authorization": f"Bearer {jupyter_token}"}

        async with httpx.AsyncClient() as client:
            try:
                response = await client.request(
                    method,
                    url,
                    headers=headers,
                    params=params,
                    json=json,
                )
                response.raise_for_status()
            except httpx.HTTPStatusError as err:
                self._raise_service_error(err)
            except httpx.RequestError as err:
                msg = "Error requesting upstream Jupyter contents service."
                raise UpstreamServiceError(msg) from err

        _log.info("%s %s proxied to Jupyter contents.", method, path)
        if response.status_code == 204 or not response.content:
            return {}

        return response.json()

    def _raise_service_error(self, err: httpx.HTTPStatusError) -> None:
        """Map upstream HTTP status codes to the service-layer error types."""
        status_code = err.response.status_code
        msg = f"Upstream Jupyter contents request failed with status {status_code}."

        if status_code == 400:
            raise BadRequestError(msg) from err
        if status_code == 401:
            raise UnauthorizedError(msg) from err
        if status_code == 403:
            raise ForbiddenError(msg) from err
        if status_code == 404:
            raise NotFoundError(msg) from err
        if status_code == 409:
            msg = "A file with this name already exists."
            raise ConflictError(msg) from err

        raise UpstreamServiceError(msg, status_code=status_code) from err
