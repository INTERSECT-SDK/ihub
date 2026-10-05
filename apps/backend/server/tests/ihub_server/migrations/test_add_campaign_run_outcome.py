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
        / "2026_09_23_1200-e9a5c7d1f203_add_campaign_run_outcome.py"
    )
    spec = importlib.util.spec_from_file_location("add_campaign_run_outcome", migration_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def _run_migration(connection, migration_function) -> None:
    context = MigrationContext.configure(connection)
    with Operations.context(context):
        migration_function()


def test_upgrade_backfills_only_completed_runs():
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    runs = sa.Table(
        "campaignrun",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("status", sa.String(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            runs.insert(),
            [
                {"id": 1, "status": "COMPLETED"},
                {"id": 2, "status": "ABORTED"},
                {"id": 3, "status": "ACTIVE"},
                {"id": 4, "status": None},
            ],
        )
        migration = _migration_module()
        _run_migration(connection, migration.upgrade)

        upgraded_runs = sa.Table("campaignrun", sa.MetaData(), autoload_with=connection)
        rows = connection.execute(sa.select(upgraded_runs).order_by(upgraded_runs.c.id)).mappings()

        assert [row["outcome"] for row in rows] == ["SUCCEEDED", None, None, None]

        _run_migration(connection, migration.downgrade)
        column_names = {
            column["name"] for column in sa.inspect(connection).get_columns("campaignrun")
        }
        assert "outcome" not in column_names

    engine.dispose()
