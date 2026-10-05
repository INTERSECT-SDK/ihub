import importlib.util
from datetime import datetime
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError

CONSTRAINT_NAME = "uq_lifecyclemessage_broker_capability_context"
CONSTRAINT_COLUMNS = [
    "broker_id",
    "organization",
    "facility",
    "system",
    "subsystem",
    "service",
    "sdk_capability_name",
]


def _migration_module():
    migration_path = (
        Path(__file__).parents[3]
        / "migrations"
        / "versions"
        / "2026_07_10_1200-d4e8c2a71f90_deduplicate_lifecycle_messages.py"
    )
    spec = importlib.util.spec_from_file_location(
        "deduplicate_lifecycle_messages",
        migration_path,
    )
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def _pre_branch_lifecycle_table(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "lifecyclemessage",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("message_id", sa.String(), nullable=False),
        sa.Column("broker_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("organization", sa.String(), nullable=False),
        sa.Column("facility", sa.String(), nullable=False),
        sa.Column("system", sa.String(), nullable=False),
        sa.Column("service", sa.String(), nullable=False),
        sa.Column("sdk_capability_name", sa.String(), nullable=False),
        sa.Column("endpoint_names", sa.String(), nullable=False),
    )


def _row(
    row_id: int,
    message_id: str,
    created_at: datetime,
    *,
    subsystem: str | None = None,
) -> dict[str, object]:
    return {
        "id": row_id,
        "message_id": message_id,
        "broker_id": 1,
        "created_at": created_at,
        "organization": "org",
        "facility": "facility",
        "system": "system",
        "subsystem": subsystem,
        "service": "service",
        "sdk_capability_name": "capability",
        "endpoint_names": "endpoint",
    }


def _run_migration(connection, migration_function) -> None:
    context = MigrationContext.configure(connection)
    with Operations.context(context):
        migration_function()


def test_upgrade_preserves_legacy_rows_and_enforces_scoped_uniqueness():
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    lifecycle_table = _pre_branch_lifecycle_table(metadata)
    metadata.create_all(engine)
    oldest = datetime(2026, 7, 10, 10)
    newest = datetime(2026, 7, 10, 11)

    with engine.begin() as connection:
        legacy_rows = [
            _row(1, "legacy-1", oldest),
            _row(2, "legacy-2", newest),
        ]
        for row in legacy_rows:
            row.pop("subsystem")
        connection.execute(lifecycle_table.insert(), legacy_rows)

        migration = _migration_module()
        _run_migration(connection, migration.upgrade)

        upgraded = sa.Table("lifecyclemessage", sa.MetaData(), autoload_with=connection)
        stored = connection.execute(sa.select(upgraded).order_by(upgraded.c.id)).all()
        assert [row.message_id for row in stored] == ["legacy-1", "legacy-2"]
        assert [row.subsystem for row in stored] == [None, None]
        assert [row.last_updated for row in stored] == [oldest, newest]

        columns = {
            column["name"]: column
            for column in sa.inspect(connection).get_columns("lifecyclemessage")
        }
        assert columns["subsystem"]["nullable"]
        assert not columns["last_updated"]["nullable"]
        assert sa.inspect(connection).get_unique_constraints("lifecyclemessage") == [
            {
                "name": CONSTRAINT_NAME,
                "column_names": CONSTRAINT_COLUMNS,
            }
        ]

        known_subsystem = _row(3, "known-subsystem", newest, subsystem="subsystem-a")
        known_subsystem["last_updated"] = newest
        connection.execute(upgraded.insert().values(**known_subsystem))

        duplicate = _row(4, "duplicate", newest, subsystem="subsystem-a")
        duplicate["last_updated"] = newest
        with pytest.raises(IntegrityError), connection.begin_nested():
            connection.execute(upgraded.insert().values(**duplicate))

        different_subsystem = _row(5, "different", newest, subsystem="subsystem-b")
        different_subsystem["last_updated"] = newest
        connection.execute(upgraded.insert().values(**different_subsystem))

        unknown_subsystem = _row(6, "legacy-3", newest)
        unknown_subsystem["last_updated"] = newest
        connection.execute(upgraded.insert().values(**unknown_subsystem))

        assert (
            connection.execute(sa.select(sa.func.count()).select_from(upgraded)).scalar_one() == 5
        )

    engine.dispose()


def test_downgrade_removes_constraint_and_columns_without_deleting_rows():
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    lifecycle_table = _pre_branch_lifecycle_table(metadata)
    metadata.create_all(engine)
    published_at = datetime(2026, 7, 10, 10)

    with engine.begin() as connection:
        rows = [
            _row(1, "legacy-1", published_at),
            _row(2, "legacy-2", published_at),
        ]
        for row in rows:
            row.pop("subsystem")
        connection.execute(lifecycle_table.insert(), rows)

        migration = _migration_module()
        _run_migration(connection, migration.upgrade)
        _run_migration(connection, migration.downgrade)

        downgraded = sa.Table("lifecyclemessage", sa.MetaData(), autoload_with=connection)
        assert "last_updated" not in downgraded.c
        assert "subsystem" not in downgraded.c
        assert not sa.inspect(connection).get_unique_constraints("lifecyclemessage")
        stored = connection.execute(sa.select(downgraded).order_by(downgraded.c.id)).all()
        assert [row.message_id for row in stored] == ["legacy-1", "legacy-2"]

    engine.dispose()
