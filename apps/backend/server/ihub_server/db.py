"""
Database and other storage connection definitions
"""

from collections.abc import Generator
from typing import Annotated, Any

from fastapi import Depends, Request
from sqlmodel import Session, create_engine

from .core.environment import settings

engine = create_engine(settings.postgres_url, pool_size=20)


def create_session() -> Session:
    return Session(engine)


def get_session() -> Generator[Session, None, None]:
    """Get the database session"""
    with create_session() as session:
        yield session


def validate_user_session(user_info: object) -> dict[str, Any] | None:
    """Validate and normalize an authenticated user session from Redis."""
    if not isinstance(user_info, dict) or user_info.get("role") != "user":
        return None

    subject_id = str(user_info.get("subject_id") or user_info.get("sub") or "").strip()
    email = str(user_info.get("email") or "").strip().lower()
    if not subject_id or not email:
        return None

    return {**user_info, "subject_id": subject_id, "email": email, "role": "user"}


async def get_user(request: Request) -> dict[str, Any] | None:
    session_id = request.cookies.get("IHUB_SESSION")
    if not session_id:
        return None
    user_info = await request.app.state.redis.json().get(session_id)
    return validate_user_session(user_info)


SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[dict[str, Any] | None, Depends(get_user)]
