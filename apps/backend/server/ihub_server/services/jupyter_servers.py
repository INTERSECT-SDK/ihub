"""Service layer for Jupyter server CRUD and lookup operations."""

from sqlmodel import Session

from ihub_server.models import JupyterCreate, JupyterServer, JupyterUpdate
from ihub_server.repositories import jupyter_servers as jupyter_repository
from ihub_server.services.errors import NotFoundError


class JupyterServerService:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_jupyter_servers(self, offset: int, limit: int) -> list[JupyterServer]:
        return jupyter_repository.list_jupyter_servers(self._session, offset, limit)

    def get_jupyter_server(self, jupyter_id: int) -> JupyterServer:
        jupyter = jupyter_repository.get_jupyter_server(self._session, jupyter_id)
        if not jupyter:
            msg = "Jupyter server not found"
            raise NotFoundError(msg)
        return jupyter

    def get_jupyter_server_by_label(self, label: str) -> JupyterServer:
        jupyter = jupyter_repository.get_jupyter_server_by_label(self._session, label)
        if not jupyter:
            msg = "Jupyter server not found. Is 'local' jupyter server added?"
            raise NotFoundError(msg)
        return jupyter

    def create_jupyter_server(self, jupyter_server: JupyterCreate) -> JupyterServer:
        return jupyter_repository.create_jupyter_server(self._session, jupyter_server)

    def update_jupyter_server(self, jupyter_id: int, updates: JupyterUpdate) -> JupyterServer:
        jupyter = jupyter_repository.get_jupyter_server(self._session, jupyter_id)
        if not jupyter:
            msg = "Jupyter server not found"
            raise NotFoundError(msg)
        return jupyter_repository.update_jupyter_server(self._session, jupyter, updates)

    def delete_jupyter_server(self, jupyter_id: int) -> None:
        jupyter = jupyter_repository.get_jupyter_server(self._session, jupyter_id)
        if not jupyter:
            msg = "Jupyter server not found"
            raise NotFoundError(msg)
        jupyter_repository.delete_jupyter_server(self._session, jupyter)
