from types import SimpleNamespace
from uuid import uuid4

import pytest

from ihub_server.models import AccessLevel, Project, ProjectPermission, ProjectVisibility
from ihub_server.services.errors import ForbiddenError, NotFoundError
from ihub_server.services.projects import ProjectService


def make_project(owner_id, *, visibility=ProjectVisibility.PRIVATE):
    return Project(name="Project", owner_id=owner_id, visibility=visibility)


def make_permission(project_id, user_id, access_level):
    return ProjectPermission(
        project_id=project_id,
        user_id=user_id,
        access_level=access_level,
    )


@pytest.mark.parametrize(
    ("caller", "permission_level", "expected"),
    [
        ("owner", None, AccessLevel.EDIT),
        ("member", AccessLevel.EDIT, AccessLevel.EDIT),
        ("member", AccessLevel.VIEW, AccessLevel.VIEW),
        ("public", None, AccessLevel.VIEW),
    ],
)
def test_public_project_includes_effective_current_user_access_level(
    monkeypatch,
    caller,
    permission_level,
    expected,
):
    owner_id = uuid4()
    caller_id = owner_id if caller == "owner" else uuid4()
    project = make_project(owner_id, visibility=ProjectVisibility.PUBLIC)
    permissions = (
        [make_permission(project.id, caller_id, permission_level)] if permission_level else []
    )
    monkeypatch.setattr(
        "ihub_server.services.projects.project_repository.get_user_by_id",
        lambda *_args: SimpleNamespace(email="owner@example.com"),
    )
    monkeypatch.setattr(
        "ihub_server.services.projects.project_repository.list_permissions",
        lambda *_args: permissions,
    )

    public_project = ProjectService(SimpleNamespace()).to_public_project(project, caller_id)

    assert public_project.current_user_access_level == expected


@pytest.mark.parametrize("caller", ["owner", "editor"])
def test_require_edit_access_allows_owner_or_explicit_editor(monkeypatch, caller):
    owner_id = uuid4()
    caller_id = owner_id if caller == "owner" else uuid4()
    project = make_project(owner_id)
    permission = (
        None if caller == "owner" else make_permission(project.id, caller_id, AccessLevel.EDIT)
    )
    monkeypatch.setattr(
        "ihub_server.services.projects.project_repository.get_project",
        lambda *_args: project,
    )
    monkeypatch.setattr(
        "ihub_server.services.projects.project_repository.get_permission",
        lambda *_args: permission,
    )

    ProjectService(SimpleNamespace()).require_edit_access(project.id, caller_id)


@pytest.mark.parametrize("visibility", [ProjectVisibility.PRIVATE, ProjectVisibility.PUBLIC])
def test_require_edit_access_rejects_view_only_and_public_fallback(
    monkeypatch,
    visibility,
):
    owner_id = uuid4()
    caller_id = uuid4()
    project = make_project(owner_id, visibility=visibility)
    permission = (
        make_permission(project.id, caller_id, AccessLevel.VIEW)
        if visibility == ProjectVisibility.PRIVATE
        else None
    )
    monkeypatch.setattr(
        "ihub_server.services.projects.project_repository.get_project",
        lambda *_args: project,
    )
    monkeypatch.setattr(
        "ihub_server.services.projects.project_repository.get_permission",
        lambda *_args: permission,
    )

    with pytest.raises(ForbiddenError, match="Edit access"):
        ProjectService(SimpleNamespace()).require_edit_access(project.id, caller_id)


def test_require_edit_access_rejects_missing_project(monkeypatch):
    monkeypatch.setattr(
        "ihub_server.services.projects.project_repository.get_project",
        lambda *_args: None,
    )

    with pytest.raises(NotFoundError, match="Project not found"):
        ProjectService(SimpleNamespace()).require_edit_access(uuid4(), uuid4())
