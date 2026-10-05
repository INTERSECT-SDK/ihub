"""add broker auto connect enabled

Revision ID: 9b6d2a4c8f10
Revises: 7187d5d45fa8
Create Date: 2026-07-07 21:00:00.000000+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9b6d2a4c8f10"
down_revision: str | None = "7187d5d45fa8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "broker",
        sa.Column(
            "auto_connect_enabled",
            sa.Boolean(),
            server_default=sa.true(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("broker", "auto_connect_enabled")
