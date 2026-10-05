"""Merge multiple heads

Revision ID: f075fa4d3e5a
Revises: efe1ce8740f6, b65e8cc9ac79
Create Date: 2026-02-19 04:49:56.212217+00:00

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "f075fa4d3e5a"
down_revision: str | None = ("efe1ce8740f6", "b65e8cc9ac79")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""


def downgrade() -> None:
    """Downgrade schema."""
