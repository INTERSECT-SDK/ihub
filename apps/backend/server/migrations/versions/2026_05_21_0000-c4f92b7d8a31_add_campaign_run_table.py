"""add campaign run table

Revision ID: c4f92b7d8a31
Revises: b7f9d2c8e4a1
Create Date: 2026-05-21 00:00:00.000000+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4f92b7d8a31"
down_revision: str | None = "b7f9d2c8e4a1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "campaignrun",
        sa.Column("user_email", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("campaign_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("run_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("run_at", sa.DateTime(), nullable=False),
        sa.Column("orchestrator_url", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_campaignrun_campaign_id"), "campaignrun", ["campaign_id"])
    op.create_index(op.f("ix_campaignrun_run_at"), "campaignrun", ["run_at"])
    op.create_index(op.f("ix_campaignrun_run_id"), "campaignrun", ["run_id"], unique=True)
    op.create_index(op.f("ix_campaignrun_user_email"), "campaignrun", ["user_email"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_campaignrun_user_email"), table_name="campaignrun")
    op.drop_index(op.f("ix_campaignrun_run_id"), table_name="campaignrun")
    op.drop_index(op.f("ix_campaignrun_run_at"), table_name="campaignrun")
    op.drop_index(op.f("ix_campaignrun_campaign_id"), table_name="campaignrun")
    op.drop_table("campaignrun")
