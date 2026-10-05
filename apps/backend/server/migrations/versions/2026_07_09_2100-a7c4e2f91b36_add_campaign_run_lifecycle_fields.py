"""add campaign run lifecycle fields

Revision ID: a7c4e2f91b36
Revises: 9b6d2a4c8f10
Create Date: 2026-07-09 21:00:00.000000+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7c4e2f91b36"
down_revision: str | None = "9b6d2a4c8f10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add lifecycle fields without classifying existing campaign runs."""
    op.add_column(
        "campaignrun",
        sa.Column("status", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.add_column("campaignrun", sa.Column("ended_at", sa.DateTime(), nullable=True))
    op.add_column(
        "campaignrun",
        sa.Column("campaign_name", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.add_column("campaignrun", sa.Column("broker_id", sa.Integer(), nullable=True))
    op.create_index(
        "ix_campaignrun_user_email_status_run_at",
        "campaignrun",
        ["user_email", "status", "run_at"],
    )
    op.alter_column("campaignrun", "status", server_default="ACTIVE")


def downgrade() -> None:
    """Remove campaign run lifecycle fields."""
    op.drop_index("ix_campaignrun_user_email_status_run_at", table_name="campaignrun")
    op.drop_column("campaignrun", "broker_id")
    op.drop_column("campaignrun", "campaign_name")
    op.drop_column("campaignrun", "ended_at")
    op.drop_column("campaignrun", "status")
