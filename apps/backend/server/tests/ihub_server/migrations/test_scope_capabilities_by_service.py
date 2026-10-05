import importlib.util
from datetime import datetime
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError

CONSTRAINT_NAME = "uq_capability_service_id_name"
CONSTRAINT_COLUMNS = ["service_id", "name"]


def _migration_module():
    migration_path = (
        Path(__file__).parents[3]
        / "migrations"
        / "versions"
        / "2026_08_24_1200-c3b6e9a247d1_scope_capabilities_by_service.py"
    )
    spec = importlib.util.spec_from_file_location(
        "scope_capabilities_by_service",
        migration_path,
    )
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def _capability_table(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "capability",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("broker_id", sa.Integer(), nullable=True),
        sa.Column("service_id", sa.Integer(), nullable=False),
        sa.Column("last_lifecycle_message", sa.DateTime(), nullable=True),
        sa.Column("endpoints_schema", sa.JSON(), nullable=True),
    )


def _row(
    row_id: int,
    *,
    service_id: int,
    created_at: datetime,
    last_lifecycle_message: datetime | None,
) -> dict[str, object]:
    return {
        "id": row_id,
        "name": "shared-capability",
        "created_at": created_at,
        "broker_id": row_id,
        "service_id": service_id,
        "last_lifecycle_message": last_lifecycle_message,
        "endpoints_schema": {"row": row_id},
    }


def _run_migration(connection, migration_function) -> None:
    context = MigrationContext.configure(connection)
    with Operations.context(context):
        migration_function()


def test_upgrade_keeps_newest_exact_key_and_preserves_cross_service_names():
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    capability_table = _capability_table(metadata)
    metadata.create_all(engine)
    created_at = datetime(2026, 8, 24, 10)
    newest_publication = datetime(2026, 8, 24, 12)

    with engine.begin() as connection:
        connection.execute(
            capability_table.insert(),
            [
                _row(
                    1,
                    service_id=1,
                    created_at=created_at,
                    last_lifecycle_message=datetime(2026, 8, 24, 11),
                ),
                _row(
                    2,
                    service_id=1,
                    created_at=created_at,
                    last_lifecycle_message=newest_publication,
                ),
                _row(
                    3,
                    service_id=1,
                    created_at=created_at,
                    last_lifecycle_message=newest_publication,
                ),
                _row(
                    4,
                    service_id=2,
                    created_at=datetime(2026, 8, 24, 9),
                    last_lifecycle_message=None,
                ),
            ],
        )

        migration = _migration_module()
        _run_migration(connection, migration.upgrade)

        upgraded = sa.Table("capability", sa.MetaData(), autoload_with=connection)
        stored = connection.execute(sa.select(upgraded).order_by(upgraded.c.id)).all()
        assert [row.id for row in stored] == [3, 4]
        assert [row.service_id for row in stored] == [1, 2]
        assert sa.inspect(connection).get_unique_constraints("capability") == [
            {
                "name": CONSTRAINT_NAME,
                "column_names": CONSTRAINT_COLUMNS,
            }
        ]

        with pytest.raises(IntegrityError), connection.begin_nested():
            connection.execute(
                upgraded.insert().values(
                    **_row(
                        5,
                        service_id=1,
                        created_at=created_at,
                        last_lifecycle_message=None,
                    )
                )
            )

        connection.execute(
            upgraded.insert().values(
                **_row(
                    6,
                    service_id=3,
                    created_at=created_at,
                    last_lifecycle_message=None,
                )
            )
        )

    engine.dispose()


def test_downgrade_removes_constraint_without_deleting_surviving_rows():
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    capability_table = _capability_table(metadata)
    metadata.create_all(engine)
    created_at = datetime(2026, 8, 24, 10)

    with engine.begin() as connection:
        connection.execute(
            capability_table.insert(),
            [
                _row(
                    1,
                    service_id=1,
                    created_at=created_at,
                    last_lifecycle_message=None,
                ),
                _row(
                    2,
                    service_id=1,
                    created_at=datetime(2026, 8, 24, 11),
                    last_lifecycle_message=None,
                ),
                _row(
                    3,
                    service_id=2,
                    created_at=created_at,
                    last_lifecycle_message=None,
                ),
            ],
        )

        migration = _migration_module()
        _run_migration(connection, migration.upgrade)
        _run_migration(connection, migration.downgrade)

        downgraded = sa.Table("capability", sa.MetaData(), autoload_with=connection)
        assert not sa.inspect(connection).get_unique_constraints("capability")
        stored = connection.execute(sa.select(downgraded).order_by(downgraded.c.id)).all()
        assert [row.id for row in stored] == [2, 3]

        connection.execute(
            downgraded.insert().values(
                **_row(
                    4,
                    service_id=1,
                    created_at=created_at,
                    last_lifecycle_message=None,
                )
            )
        )

    engine.dispose()
