"""add remote agent protocol

Revision ID: e5f9a3b72c14
Revises: d4e8c2a71f90
Create Date: 2026-07-21 12:00:00.000000+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5f9a3b72c14"
down_revision: str | None = "d4e8c2a71f90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Identify the protocol used by configured and discovered remote agents."""
    op.add_column(
        "remoteagentserver",
        sa.Column(
            "protocol",
            sa.String(),
            server_default="langgraph",
            nullable=False,
        ),
    )
    op.add_column(
        "remoteagent",
        sa.Column(
            "protocol",
            sa.String(),
            server_default="langgraph",
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Remove remote-agent protocol metadata."""
    with op.batch_alter_table("remoteagent") as batch_op:
        batch_op.drop_column("protocol")
    with op.batch_alter_table("remoteagentserver") as batch_op:
        batch_op.drop_column("protocol")
