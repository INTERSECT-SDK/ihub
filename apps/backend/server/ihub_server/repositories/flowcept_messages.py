"""Repository queries for FlowceptMessage records ordered by creation time."""

from typing import Any, cast

from sqlalchemy import desc
from sqlmodel import Session, select

from ihub_server.models import FlowceptMessage


def list_messages(session: Session, offset: int, limit: int) -> list[FlowceptMessage]:
    statement = (
        select(FlowceptMessage)
        .order_by(desc(cast(Any, FlowceptMessage.created_at)))
        .offset(offset)
        .limit(limit)
    )
    return cast(list[FlowceptMessage], session.exec(statement).all())


def list_messages_by_activity(
    session: Session,
    activity_id: str,
    offset: int,
    limit: int,
) -> list[FlowceptMessage]:
    statement = (
        select(FlowceptMessage)
        .order_by(desc(cast(Any, FlowceptMessage.created_at)))
        .where(FlowceptMessage.activity_id == activity_id)
        .offset(offset)
        .limit(limit)
    )
    return cast(list[FlowceptMessage], session.exec(statement).all())
