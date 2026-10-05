"""Index orchestrator event log pages.

Revision ID: f2a1c4d8e6b0
Revises: e5f9a3b72c14
Create Date: 2026-08-17 22:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2a1c4d8e6b0"
down_revision: str | None = "e5f9a3b72c14"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the covering index used by step-scoped event log pages."""
    op.create_index(
        "ix_orchestratorevent_run_id_step_id_id",
        "orchestratorevent",
        ["run_id", "step_id", "id"],
        unique=False,
    )


def downgrade() -> None:
    """Remove the event log paging index."""
    op.drop_index(
        "ix_orchestratorevent_run_id_step_id_id",
        table_name="orchestratorevent",
    )
