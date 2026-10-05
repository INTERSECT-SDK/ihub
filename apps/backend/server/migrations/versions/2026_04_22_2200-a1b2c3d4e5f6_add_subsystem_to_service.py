"""add subsystem to service

Revision ID: a1b2c3d4e5f6
Revises: 39c201bdf90f
Create Date: 2026-04-22 22:00:00.000000+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "39c201bdf90f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("service", sa.Column("subsystem", sa.String(), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("service", "subsystem")
