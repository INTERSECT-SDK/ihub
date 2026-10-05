"""Create remote agent server and remote agent schema (squashed)."""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1c7e9a4b2d11"
down_revision: str | None = "e22c8d57a8b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "remoteagentserver",
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("url", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("status", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("assistant_id", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("auth_token", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_remoteagentserver_name",
        "remoteagentserver",
        ["name"],
        unique=False,
    )

    op.create_table(
        "remoteagent",
        sa.Column("remote_agent_server_id", sa.Integer(), nullable=False),
        sa.Column("assistant_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("graph_id", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("assistant_metadata", sa.JSON(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("remote_updated_at", sa.DateTime(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["remote_agent_server_id"], ["remoteagentserver.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "remote_agent_server_id",
            "assistant_id",
            name="uq_remoteagent_remote_agent_server_agent",
        ),
    )
    op.create_index(
        "ix_remoteagent_assistant_id",
        "remoteagent",
        ["assistant_id"],
        unique=False,
    )
    op.create_index(
        "ix_remoteagent_remote_agent_server_id",
        "remoteagent",
        ["remote_agent_server_id"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_remoteagent_assistant_id", table_name="remoteagent")
    op.drop_index(
        "ix_remoteagent_remote_agent_server_id",
        table_name="remoteagent",
    )
    op.drop_table("remoteagent")

    op.drop_index("ix_remoteagentserver_name", table_name="remoteagentserver")
    op.drop_table("remoteagentserver")
