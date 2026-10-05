"""Add active lifecycle ingest errors to capabilities.

Revision ID: f4b8c2d6e901
Revises: e9a5c7d1f203
Create Date: 2026-09-26 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f4b8c2d6e901"
down_revision: str | None = "e9a5c7d1f203"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Store only the current lifecycle ingest failure, when present."""
    with op.batch_alter_table("capability") as batch_op:
        batch_op.add_column(sa.Column("lifecycle_error", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("lifecycle_error_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    """Remove lifecycle ingest failure state."""
    with op.batch_alter_table("capability") as batch_op:
        batch_op.drop_column("lifecycle_error_at")
        batch_op.drop_column("lifecycle_error")
