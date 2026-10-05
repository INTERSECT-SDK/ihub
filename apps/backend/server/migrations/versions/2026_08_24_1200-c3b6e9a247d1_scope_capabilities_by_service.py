"""Scope capability identity by service.

Revision ID: c3b6e9a247d1
Revises: f2a1c4d8e6b0
Create Date: 2026-08-24 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3b6e9a247d1"
down_revision: str | None = "f2a1c4d8e6b0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CAPABILITY_SERVICE_NAME_CONSTRAINT = "uq_capability_service_id_name"
CAPABILITY_SERVICE_NAME_COLUMNS = ["service_id", "name"]


def upgrade() -> None:
    """Deduplicate exact capability keys and enforce service-scoped identity."""
    op.execute(
        sa.text(
            """
            DELETE FROM capability
            WHERE id IN (
                SELECT id
                FROM (
                    SELECT
                        id,
                        ROW_NUMBER() OVER (
                            PARTITION BY service_id, name
                            ORDER BY
                                COALESCE(last_lifecycle_message, created_at) DESC,
                                id DESC
                        ) AS duplicate_rank
                    FROM capability
                ) AS ranked_capabilities
                WHERE duplicate_rank > 1
            )
            """
        )
    )

    with op.batch_alter_table("capability") as batch_op:
        batch_op.create_unique_constraint(
            CAPABILITY_SERVICE_NAME_CONSTRAINT,
            CAPABILITY_SERVICE_NAME_COLUMNS,
        )


def downgrade() -> None:
    """Remove service-scoped uniqueness without recreating deleted rows."""
    with op.batch_alter_table("capability") as batch_op:
        batch_op.drop_constraint(
            CAPABILITY_SERVICE_NAME_CONSTRAINT,
            type_="unique",
        )
