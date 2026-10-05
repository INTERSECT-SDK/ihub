"""Repository functions for JupyterServer CRUD and label lookups."""

from typing import cast

from sqlmodel import Session, select

from ihub_server.models import JupyterCreate, JupyterServer, JupyterUpdate


def list_jupyter_servers(session: Session, offset: int, limit: int) -> list[JupyterServer]:
    return cast(
        list[JupyterServer],
        session.exec(select(JupyterServer).offset(offset).limit(limit)).all(),
    )


def get_jupyter_server(session: Session, jupyter_id: int) -> JupyterServer | None:
    return session.get(JupyterServer, jupyter_id)


def get_jupyter_server_by_label(session: Session, label: str) -> JupyterServer | None:
    return session.exec(select(JupyterServer).where(JupyterServer.label == label)).first()


def create_jupyter_server(session: Session, jupyter_server: JupyterCreate) -> JupyterServer:
    db_jupyter = JupyterServer.model_validate(jupyter_server)
    session.add(db_jupyter)
    session.commit()
    session.refresh(db_jupyter)
    return db_jupyter


def update_jupyter_server(
    session: Session, jupyter_server: JupyterServer, updates: JupyterUpdate
) -> JupyterServer:
    jupyter_data = updates.model_dump(exclude_unset=True)
    jupyter_server.sqlmodel_update(jupyter_data)
    session.add(jupyter_server)
    session.commit()
    session.refresh(jupyter_server)
    return jupyter_server


def delete_jupyter_server(session: Session, jupyter_server: JupyterServer) -> None:
    session.delete(jupyter_server)
    session.commit()
