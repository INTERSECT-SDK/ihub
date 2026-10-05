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
        / "2026_07_21_1200-e5f9a3b72c14_add_remote_agent_protocol.py"
    )
    spec = importlib.util.spec_from_file_location("add_remote_agent_protocol", migration_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def _run_migration(connection, migration_function) -> None:
    context = MigrationContext.configure(connection)
    with Operations.context(context):
        migration_function()


def _create_legacy_tables(metadata: sa.MetaData) -> tuple[sa.Table, sa.Table]:
    servers = sa.Table(
        "remoteagentserver",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("url", sa.String(), nullable=False),
    )
    agents = sa.Table(
        "remoteagent",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("remote_agent_server_id", sa.Integer(), nullable=False),
        sa.Column("assistant_id", sa.String(), nullable=False),
    )
    return servers, agents


def test_upgrade_defaults_existing_remote_agents_to_langgraph():
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    servers, agents = _create_legacy_tables(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            servers.insert().values(id=1, name="Existing", url="https://agent.example.com")
        )
        connection.execute(
            agents.insert().values(id=2, remote_agent_server_id=1, assistant_id="assistant")
        )

        _run_migration(connection, _migration_module().upgrade)

        upgraded_servers = sa.Table(
            "remoteagentserver",
            sa.MetaData(),
            autoload_with=connection,
        )
        upgraded_agents = sa.Table("remoteagent", sa.MetaData(), autoload_with=connection)
        assert (
            connection.execute(sa.select(upgraded_servers.c.protocol)).scalar_one() == "langgraph"
        )
        assert connection.execute(sa.select(upgraded_agents.c.protocol)).scalar_one() == "langgraph"

    engine.dispose()


def test_downgrade_removes_protocol_columns():
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    _create_legacy_tables(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        migration = _migration_module()
        _run_migration(connection, migration.upgrade)
        _run_migration(connection, migration.downgrade)

        server_columns = {
            column["name"] for column in sa.inspect(connection).get_columns("remoteagentserver")
        }
        agent_columns = {
            column["name"] for column in sa.inspect(connection).get_columns("remoteagent")
        }
        assert "protocol" not in server_columns
        assert "protocol" not in agent_columns

    engine.dispose()
