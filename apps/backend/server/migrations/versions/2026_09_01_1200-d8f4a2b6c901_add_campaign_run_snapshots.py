"""Add submitted and orchestrator campaign snapshots to campaign runs.

Revision ID: d8f4a2b6c901
Revises: c3b6e9a247d1
Create Date: 2026-09-01 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d8f4a2b6c901"
down_revision: str | None = "c3b6e9a247d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add nullable snapshots so existing run history remains valid."""
    with op.batch_alter_table("campaignrun") as batch_op:
        batch_op.add_column(sa.Column("submitted_campaign_snapshot", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("orchestrator_campaign_snapshot", sa.JSON(), nullable=True))


def downgrade() -> None:
    """Remove campaign provenance snapshots."""
    with op.batch_alter_table("campaignrun") as batch_op:
        batch_op.drop_column("orchestrator_campaign_snapshot")
        batch_op.drop_column("submitted_campaign_snapshot")
