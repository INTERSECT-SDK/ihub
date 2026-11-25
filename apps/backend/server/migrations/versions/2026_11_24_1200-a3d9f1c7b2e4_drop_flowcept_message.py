"""Drop the Flowcept message table now that Flowcept is removed.

Revision ID: a3d9f1c7b2e4
Revises: f4b8c2d6e901
Create Date: 2026-11-24 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a3d9f1c7b2e4"
down_revision: str | None = "f4b8c2d6e901"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop stored Flowcept messages; this data is not restored on downgrade."""
    op.drop_index(op.f("ix_flowceptmessage_campaign_id"), table_name="flowceptmessage")
    op.drop_index(op.f("ix_flowceptmessage_activity_id"), table_name="flowceptmessage")
    op.drop_table("flowceptmessage")


def downgrade() -> None:
    """Recreate an empty Flowcept message table."""
    op.create_table(
        "flowceptmessage",
        sa.Column("activity_id", sa.String(), nullable=False),
        sa.Column("campaign_id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("message", sa.JSON(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_flowceptmessage_activity_id"), "flowceptmessage", ["activity_id"], unique=False
    )
    op.create_index(
        op.f("ix_flowceptmessage_campaign_id"), "flowceptmessage", ["campaign_id"], unique=False
    )
