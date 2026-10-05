"""Schemas for Project management and sharing."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class ProjectVisibility(str, Enum):
    """Project visibility levels."""

    PRIVATE = "private"  # Owner only
    SHARED = "shared"  # Shared with specific users
    PUBLIC = "public"  # All authenticated users


class AccessLevel(str, Enum):
    """Access levels for project sharing."""

    VIEW = "view"  # Read-only access
    EDIT = "edit"  # Read and modify access


class ProjectBase(SQLModel):
    """Base Project model."""

    name: str
    description: str | None = None
    visibility: ProjectVisibility = ProjectVisibility.PRIVATE
    owner_id: UUID


class Project(ProjectBase, table=True):
    """Project model for DB storage."""

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class ProjectPublic(ProjectBase):
    """Public Project model."""

    id: UUID
    owner_email: str | None = None
    current_user_access_level: AccessLevel
    created_at: datetime
    updated_at: datetime


class ProjectCreate(SQLModel):
    """Create Project model."""

    name: str
    description: str | None = None
    visibility: ProjectVisibility = ProjectVisibility.PRIVATE


class ProjectUpdate(SQLModel):
    """Update Project model."""

    name: str | None = None
    description: str | None = None
    visibility: ProjectVisibility | None = None


class ProjectPermissionBase(SQLModel):
    """Base ProjectPermission model."""

    project_id: UUID
    user_id: UUID
    access_level: AccessLevel = AccessLevel.VIEW


class ProjectPermission(ProjectPermissionBase, table=True):
    """ProjectPermission model for DB storage."""

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class ProjectPermissionPublic(ProjectPermissionBase):
    """Public ProjectPermission model."""

    id: UUID
    user_email: str | None = None
    created_at: datetime


class ProjectPermissionCreate(SQLModel):
    """Create ProjectPermission model."""

    user_id: UUID
    access_level: AccessLevel = AccessLevel.VIEW


class ProjectPermissionGrantRequest(SQLModel):
    """API request to grant project access, resolved by user email."""

    user_email: str
    access_level: AccessLevel = AccessLevel.VIEW
