"""Schemas for authorization and login audit data."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class LoginEventType(str, Enum):
    """Supported login-related audit events."""

    LOGIN_SUCCESS = "login_success"
    LOGIN_FAILURE = "login_failure"
    LOGOUT = "logout"


class AuthorizedUserBase(SQLModel):
    """Base model for users allowed to access iHub."""

    email: str = Field(index=True, unique=True)
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class AuthorizedUser(AuthorizedUserBase, table=True):
    """Table model for authorized users."""

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)


class AuthorizedUserPublic(AuthorizedUserBase):
    """Public model for authorized users."""

    id: UUID


class AuthorizedUserCreate(SQLModel):
    """Create payload model for authorized users."""

    email: str
    is_active: bool = True


class AuthorizedUserUpdate(SQLModel):
    """Update payload model for authorized users."""

    email: str | None = None
    is_active: bool | None = None


class LoginAuditLogBase(SQLModel):
    """Base model for authentication event logs."""

    subject_id: str | None = Field(default=None, index=True)
    email: str | None = Field(default=None, index=True)
    event_type: LoginEventType = Field(index=True)
    ip_address: str | None = None
    user_agent: str | None = None
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(UTC), index=True)


class LoginAuditLog(LoginAuditLogBase, table=True):
    """Table model for login audit entries."""

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)


class LoginAuditLogPublic(LoginAuditLogBase):
    """Public model for login audit entries."""

    id: UUID


class LoginAuditLogCreate(SQLModel):
    """Create payload model for login audit entries."""

    subject_id: str | None = None
    email: str | None = None
    event_type: LoginEventType
    ip_address: str | None = None
    user_agent: str | None = None
    occurred_at: datetime | None = None
