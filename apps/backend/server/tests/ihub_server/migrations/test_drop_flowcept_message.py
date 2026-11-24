import importlib.util
from datetime import UTC, datetime
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _migration_module():
    migration_path = (
        Path(__file__).parents[3]
        / "migrations"
        / "versions"
        / "2026_11_24_1200-a3d9f1c7b2e4_drop_flowcept_message.py"
    )
    spec = importlib.util.spec_from_file_location("drop_flowcept_message", migration_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def _run_migration(connection, migration_function) -> None:
    context = MigrationContext.configure(connection)
    with Operations.context(context):
        migration_function()


def test_upgrade_drops_flowcept_table_and_downgrade_restores_it_empty():
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    messages = sa.Table(
        "flowceptmessage",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("activity_id", sa.String(), nullable=False, index=True),
        sa.Column("campaign_id", sa.String(), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("message", sa.JSON(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            messages.insert(),
            {"activity_id": "a", "campaign_id": "c", "created_at": datetime.now(UTC)},
        )
        migration = _migration_module()

        _run_migration(connection, migration.upgrade)

        assert "flowceptmessage" not in sa.inspect(connection).get_table_names()

        _run_migration(connection, migration.downgrade)

        inspector = sa.inspect(connection)
        assert "flowceptmessage" in inspector.get_table_names()
        assert {index["name"] for index in inspector.get_indexes("flowceptmessage")} == {
            "ix_flowceptmessage_activity_id",
            "ix_flowceptmessage_campaign_id",
        }
        restored = sa.Table("flowceptmessage", sa.MetaData(), autoload_with=connection)
        assert connection.execute(sa.select(sa.func.count()).select_from(restored)).scalar() == 0
