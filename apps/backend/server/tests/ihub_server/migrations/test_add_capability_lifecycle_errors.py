import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _migration_module():
    migration_path = (
        Path(__file__).parents[3]
        / "migrations"
        / "versions"
        / "2026_09_26_1200-f4b8c2d6e901_add_capability_lifecycle_errors.py"
    )
    spec = importlib.util.spec_from_file_location("add_capability_lifecycle_errors", migration_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def _run_migration(connection, migration_function) -> None:
    context = MigrationContext.configure(connection)
    with Operations.context(context):
        migration_function()


def test_upgrade_and_downgrade_capability_lifecycle_error_columns():
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table(
        "capability",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        migration = _migration_module()
        _run_migration(connection, migration.upgrade)

        columns = {
            column["name"]: column for column in sa.inspect(connection).get_columns("capability")
        }
        assert columns["lifecycle_error"]["nullable"] is True
        assert columns["lifecycle_error_at"]["nullable"] is True

        _run_migration(connection, migration.downgrade)
        column_names = {
            column["name"] for column in sa.inspect(connection).get_columns("capability")
        }
        assert "lifecycle_error" not in column_names
        assert "lifecycle_error_at" not in column_names

    engine.dispose()
