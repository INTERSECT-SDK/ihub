"""deduplicate lifecycle messages

Revision ID: d4e8c2a71f90
Revises: a7c4e2f91b36
Create Date: 2026-07-10 12:00:00.000000+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4e8c2a71f90"
down_revision: str | None = "a7c4e2f91b36"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LIFECYCLE_MESSAGE_CONTEXT_CONSTRAINT = "uq_lifecyclemessage_broker_capability_context"
LIFECYCLE_MESSAGE_CONTEXT_COLUMNS = [
    "broker_id",
    "organization",
    "facility",
    "system",
    "subsystem",
    "service",
    "sdk_capability_name",
]


def upgrade() -> None:
    """Add hierarchy and update metadata without collapsing legacy rows."""
    op.add_column(
        "lifecyclemessage",
        sa.Column("subsystem", sa.String(), nullable=True),
    )
    op.add_column(
        "lifecyclemessage",
        sa.Column("last_updated", sa.DateTime(), nullable=True),
    )

    # Historical subsystem values were never stored and cannot be reconstructed.
    # Preserve every legacy row with an explicitly unknown subsystem, and initialize
    # its update timestamp from the publication timestamp already on that row.
    op.execute(
        sa.text(
            """
            UPDATE lifecyclemessage
            SET last_updated = created_at
            """
        )
    )

    with op.batch_alter_table("lifecyclemessage") as batch_op:
        batch_op.alter_column(
            "last_updated",
            existing_type=sa.DateTime(),
            nullable=False,
        )
        batch_op.create_unique_constraint(
            LIFECYCLE_MESSAGE_CONTEXT_CONSTRAINT,
            LIFECYCLE_MESSAGE_CONTEXT_COLUMNS,
        )


def downgrade() -> None:
    """Remove lifecycle hierarchy and update metadata."""
    with op.batch_alter_table("lifecyclemessage") as batch_op:
        batch_op.drop_constraint(
            LIFECYCLE_MESSAGE_CONTEXT_CONSTRAINT,
            type_="unique",
        )

    with op.batch_alter_table("lifecyclemessage") as batch_op:
        batch_op.drop_column("last_updated")
        batch_op.drop_column("subsystem")
