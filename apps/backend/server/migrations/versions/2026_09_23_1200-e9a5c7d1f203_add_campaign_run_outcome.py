"""Add terminal outcomes to campaign runs.

Revision ID: e9a5c7d1f203
Revises: d8f4a2b6c901
Create Date: 2026-09-23 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e9a5c7d1f203"
down_revision: str | None = "d8f4a2b6c901"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add outcomes and classify only unambiguous completed history."""
    with op.batch_alter_table("campaignrun") as batch_op:
        batch_op.add_column(sa.Column("outcome", sa.String(), nullable=True))

    op.execute(
        sa.text(
            "UPDATE campaignrun SET outcome = 'SUCCEEDED' "
            "WHERE status = 'COMPLETED' AND outcome IS NULL"
        )
    )


def downgrade() -> None:
    """Remove persisted run outcomes."""
    with op.batch_alter_table("campaignrun") as batch_op:
        batch_op.drop_column("outcome")
