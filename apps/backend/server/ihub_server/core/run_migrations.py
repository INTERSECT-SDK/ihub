def run_migrations():
    """NOTE: this command will never GENERATE migration files for you. You should run alembic on the command line to do this.

    The only thing it will do is make sure that all of the migration files have been applied against the database.
    """
    from pathlib import Path

    from alembic import command
    from alembic.config import Config

    from .environment import settings

    parent_dir = Path(__file__).parents[2]

    alembic_cfg = Config(str(parent_dir / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(parent_dir / "migrations"))
    alembic_cfg.set_main_option("sqlalchemy.url", settings.postgres_url)
    command.upgrade(alembic_cfg, "head")
