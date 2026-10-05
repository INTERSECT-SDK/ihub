"""Generate the shared JSON Schema for the Campaign contract."""

import argparse
import json
from pathlib import Path

from ihub_server.models import Campaign


def _repository_root() -> Path:
    """Locate the repository root independently of the process working directory."""
    for parent in Path(__file__).resolve().parents:
        if (parent / "pnpm-workspace.yaml").is_file():
            return parent
    raise RuntimeError("Unable to locate the repository root")


def _render_schema() -> str:
    """Render the authoritative aliased Campaign validation schema."""
    return (
        json.dumps(
            Campaign.model_json_schema(by_alias=True),
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )


def _schema_path() -> Path:
    return _repository_root() / "contracts" / "campaign" / "schema" / "campaign.schema.json"


def main() -> int:
    """Generate the schema, or report drift without writing in check mode."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail when the committed schema does not match the Pydantic model",
    )
    args = parser.parse_args()

    schema_path = _schema_path()
    expected = _render_schema()
    actual = schema_path.read_text() if schema_path.is_file() else None

    if actual == expected:
        return 0

    if args.check:
        parser.exit(
            1,
            "Campaign schema is stale. Regenerate it with:\n"
            "  pdm run python -m ihub_server.tools.generate_campaign_contract\n",
        )

    schema_path.parent.mkdir(parents=True, exist_ok=True)
    schema_path.write_text(expected)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
