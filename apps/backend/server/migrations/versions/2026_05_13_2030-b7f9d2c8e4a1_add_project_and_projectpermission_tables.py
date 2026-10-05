"""add project, projectpermission tables and project_id foreign keys

Revision ID: b7f9d2c8e4a1
Revises: a58af714dcd3
Create Date: 2026-05-13 20:30:00.000000+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7f9d2c8e4a1"
down_revision: str | None = "a58af714dcd3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "project",
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column(
            "visibility",
            sa.Enum("PRIVATE", "SHARED", "PUBLIC", name="projectvisibility"),
            nullable=False,
        ),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["authorizeduser.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_project_id"), "project", ["id"], unique=False)
    op.create_index(op.f("ix_project_owner_id"), "project", ["owner_id"], unique=False)
    op.create_index(op.f("ix_project_visibility"), "project", ["visibility"], unique=False)

    op.create_table(
        "projectpermission",
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "access_level",
            sa.Enum("VIEW", "EDIT", name="accesslevel"),
            nullable=False,
        ),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["authorizeduser.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_projectpermission_id"), "projectpermission", ["id"], unique=False)
    op.create_index(
        op.f("ix_projectpermission_project_id"), "projectpermission", ["project_id"], unique=False
    )
    op.create_index(
        op.f("ix_projectpermission_user_id"), "projectpermission", ["user_id"], unique=False
    )
    op.create_unique_constraint(
        "uq_projectpermission_project_user",
        "projectpermission",
        ["project_id", "user_id"],
    )

    # Add project_id to agent table
    op.add_column("agent", sa.Column("project_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_agent_project_id_project_id", "agent", "project", ["project_id"], ["id"]
    )
    op.create_index(op.f("ix_agent_project_id"), "agent", ["project_id"], unique=False)

    # Add project_id to llm table
    op.add_column("llm", sa.Column("project_id", sa.Uuid(), nullable=True))
    op.create_foreign_key("fk_llm_project_id_project_id", "llm", "project", ["project_id"], ["id"])
    op.create_index(op.f("ix_llm_project_id"), "llm", ["project_id"], unique=False)

    # Add project_id to mcpserver table
    op.add_column("mcpserver", sa.Column("project_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_mcpserver_project_id_project_id", "mcpserver", "project", ["project_id"], ["id"]
    )
    op.create_index(op.f("ix_mcpserver_project_id"), "mcpserver", ["project_id"], unique=False)

    # Add project_id to broker table
    op.add_column("broker", sa.Column("project_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_broker_project_id_project_id", "broker", "project", ["project_id"], ["id"]
    )
    op.create_index(op.f("ix_broker_project_id"), "broker", ["project_id"], unique=False)

    # Add project_id to remoteagentserver table
    op.add_column("remoteagentserver", sa.Column("project_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_remoteagentserver_project_id_project_id",
        "remoteagentserver",
        "project",
        ["project_id"],
        ["id"],
    )
    op.create_index(
        op.f("ix_remoteagentserver_project_id"), "remoteagentserver", ["project_id"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_remoteagentserver_project_id"), table_name="remoteagentserver")
    op.drop_constraint(
        "fk_remoteagentserver_project_id_project_id", "remoteagentserver", type_="foreignkey"
    )
    op.drop_column("remoteagentserver", "project_id")

    op.drop_index(op.f("ix_broker_project_id"), table_name="broker")
    op.drop_constraint("fk_broker_project_id_project_id", "broker", type_="foreignkey")
    op.drop_column("broker", "project_id")

    op.drop_index(op.f("ix_mcpserver_project_id"), table_name="mcpserver")
    op.drop_constraint("fk_mcpserver_project_id_project_id", "mcpserver", type_="foreignkey")
    op.drop_column("mcpserver", "project_id")

    op.drop_index(op.f("ix_llm_project_id"), table_name="llm")
    op.drop_constraint("fk_llm_project_id_project_id", "llm", type_="foreignkey")
    op.drop_column("llm", "project_id")

    op.drop_index(op.f("ix_agent_project_id"), table_name="agent")
    op.drop_constraint("fk_agent_project_id_project_id", "agent", type_="foreignkey")
    op.drop_column("agent", "project_id")

    op.drop_constraint(
        "uq_projectpermission_project_user",
        "projectpermission",
        type_="unique",
    )
    op.drop_index(op.f("ix_projectpermission_user_id"), table_name="projectpermission")
    op.drop_index(op.f("ix_projectpermission_project_id"), table_name="projectpermission")
    op.drop_index(op.f("ix_projectpermission_id"), table_name="projectpermission")
    op.drop_table("projectpermission")

    op.drop_index(op.f("ix_project_visibility"), table_name="project")
    op.drop_index(op.f("ix_project_owner_id"), table_name="project")
    op.drop_index(op.f("ix_project_id"), table_name="project")
    op.drop_table("project")
