import uuid
from types import SimpleNamespace

import pytest

from ihub_server.services.campaign_validation import (
    is_uuidv4,
    validate_campaign_model_ids,
    validate_required_task_inputs,
)
from ihub_server.services.errors import ServiceError


def test_uuidv4_validation_accepts_only_canonical_version_four():
    value = str(uuid.uuid4())

    assert is_uuidv4(value)
    assert not is_uuidv4(str(uuid.uuid5(uuid.NAMESPACE_URL, value)))
    assert not is_uuidv4("not-a-uuid")


def test_campaign_id_validation_rejects_dangling_task_dependencies():
    campaign_id = str(uuid.uuid4())
    group_id = str(uuid.uuid4())
    task_id = str(uuid.uuid4())
    missing_id = str(uuid.uuid4())
    campaign = SimpleNamespace(
        id=campaign_id,
        task_groups=[
            SimpleNamespace(
                id=group_id,
                group_dependencies=[],
                tasks=[SimpleNamespace(id=task_id, task_dependencies=[missing_id])],
            )
        ],
    )

    with pytest.raises(ServiceError, match="does not match any task"):
        validate_campaign_model_ids(campaign)


def test_required_inputs_accept_manual_mapped_and_default_values():
    schema = {
        "required": ["manual", "mapped", "defaulted"],
        "properties": {"defaulted": {"type": "integer", "default": 3}},
    }

    validate_required_task_inputs(
        "task-1",
        schema,
        {"manual": 1},
        {"mapped"},
    )


def test_required_inputs_report_every_unresolved_field():
    with pytest.raises(ServiceError, match="first, second"):
        validate_required_task_inputs(
            "task-1",
            {"required": ["first", "second"], "properties": {}},
            {},
            set(),
        )
