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
        / "2026_09_01_1200-d8f4a2b6c901_add_campaign_run_snapshots.py"
    )
    spec = importlib.util.spec_from_file_location("add_campaign_run_snapshots", migration_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def _run_migration(connection, migration_function) -> None:
    context = MigrationContext.configure(connection)
    with Operations.context(context):
        migration_function()


def test_upgrade_preserves_legacy_runs_and_adds_nullable_snapshots():
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    runs = sa.Table(
        "campaignrun",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("campaign_id", sa.String(), nullable=False),
        sa.Column("run_id", sa.String(), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(runs.insert().values(id=1, campaign_id="campaign-1", run_id="run-1"))
        _run_migration(connection, _migration_module().upgrade)

        upgraded_runs = sa.Table("campaignrun", sa.MetaData(), autoload_with=connection)
        legacy_run = connection.execute(sa.select(upgraded_runs)).mappings().one()
        assert legacy_run["run_id"] == "run-1"
        assert legacy_run["submitted_campaign_snapshot"] is None
        assert legacy_run["orchestrator_campaign_snapshot"] is None

    engine.dispose()


def test_downgrade_removes_campaign_snapshot_columns():
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table(
        "campaignrun",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("campaign_id", sa.String(), nullable=False),
        sa.Column("run_id", sa.String(), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        migration = _migration_module()
        _run_migration(connection, migration.upgrade)
        _run_migration(connection, migration.downgrade)

        column_names = {
            column["name"] for column in sa.inspect(connection).get_columns("campaignrun")
        }
        assert "submitted_campaign_snapshot" not in column_names
        assert "orchestrator_campaign_snapshot" not in column_names

    engine.dispose()
