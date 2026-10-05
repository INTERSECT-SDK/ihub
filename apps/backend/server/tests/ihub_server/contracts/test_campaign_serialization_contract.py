"""Complete structure contract for canonical CampaignModel serialization."""

from copy import deepcopy
import json
from pathlib import Path
from typing import Any
import uuid

from ihub_server.models import Campaign


def _repository_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "pnpm-workspace.yaml").is_file():
            return parent
    raise RuntimeError("Unable to locate the repository root")


FIXTURE_DIR = _repository_root() / "contracts" / "campaign" / "fixtures" / "serialization"
SCHEMA_PATH = _repository_root() / "contracts" / "campaign" / "schema" / "campaign.schema.json"


def _load_fixture(name: str) -> dict[str, Any]:
    with (FIXTURE_DIR / name).open() as fixture_file:
        return json.load(fixture_file)


def _normalize_generated_values(campaign_data: dict[str, Any]) -> dict[str, Any]:
    normalized = deepcopy(campaign_data)
    assert uuid.UUID(normalized["run_id"]).version == 4
    normalized["run_id"] = "<generated-run-id>"
    generated_value_ids: dict[str, str] = {}

    def normalize_values(container: dict[str, Any] | None) -> None:
        if container is None:
            return
        for value in container["values"]:
            try:
                parsed = uuid.UUID(value["id"])
            except ValueError:
                continue
            if parsed.version == 4:
                value["id"] = generated_value_ids.setdefault(
                    value["id"], f"<generated-value-{len(generated_value_ids) + 1}>"
                )

    for task_group in normalized["task_groups"]:
        for task in task_group["tasks"]:
            normalize_values(task["input"])
            normalize_values(task["output"])
    for item in normalized["inputs"] + normalized["outputs"]:
        normalize_values(item)
    return normalized


def test_campaign_json_schema_contract() -> None:
    with SCHEMA_PATH.open() as schema_file:
        assert json.load(schema_file) == Campaign.model_json_schema(by_alias=True)


def test_canonical_campaign_aliased_serialization_contract() -> None:
    campaign = Campaign.model_validate(_load_fixture("canonical-campaign.input.json"))
    actual = campaign.model_dump(by_alias=True)
    assert _normalize_generated_values(actual) == _load_fixture(
        "canonical-campaign.serialized.json"
    )
