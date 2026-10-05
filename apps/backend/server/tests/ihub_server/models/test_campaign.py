import json
import uuid
from pathlib import Path

import pytest
from pydantic import ValidationError

from ihub_server.models import Campaign, Input, Output, Task, TaskGroup, Value


def test_random_number_campaign(random_number_campaign):
    """Test that the campaign files can be loaded and validated using the Campaign model."""
    with Path.open(random_number_campaign) as f:
        data = json.load(f)

    # This should not raise an exception if the model matches the data
    campaign = Campaign(**data)

    # Basic assertions
    assert isinstance(campaign.task_groups, list)
    assert len(campaign.task_groups) == 1
    assert campaign.id == "Campaign-b86608"
    assert campaign.name == "Campaign-b86608"
    assert campaign.user == "system"
    assert "Canonical CampaignModel fixture" in campaign.description

    # Check task group
    task_group = campaign.task_groups[0]
    assert task_group.id == "capability_group"
    assert isinstance(task_group.tasks, list)
    assert len(task_group.tasks) == 1
    assert task_group.group_dependencies == []

    # Check task details
    task = task_group.tasks[0]
    assert task.id == "generate_random_number"
    assert task.hierarchy == "capability"
    assert task.capability == "Random_Number_Generator"
    assert task.operation_id == "generate_random_number"
    assert task.event_name is None

    # Check input
    assert task.input is not None
    assert isinstance(task.input, Input)
    assert "seed" in task.input.json_schema["properties"]
    assert len(task.input.values) == 1
    assert task.input.values[0].var == "seed"

    # Check output
    assert task.output is not None
    assert isinstance(task.output, Output)
    assert "random_number" in task.output.json_schema["properties"]
    assert len(task.output.values) == 1
    assert task.output.values[0].var == "random_number"


def test_random_number_and_histogram_campaign(random_number_and_histogram_campaign):
    """Test that the histogram campaign file can be loaded and validated using the Campaign model."""
    with Path.open(random_number_and_histogram_campaign) as f:
        data = json.load(f)

    # This should not raise an exception if the model matches the data
    campaign = Campaign(**data)

    # Basic assertions
    assert isinstance(campaign.task_groups, list)
    assert len(campaign.task_groups) == 2
    assert campaign.id == "Campaign-b86608"
    assert campaign.name == "Campaign-b86608"

    # Check capability task group
    capability_group = next(tg for tg in campaign.task_groups if tg.id == "capability_group")
    assert len(capability_group.tasks) == 1
    assert capability_group.group_dependencies == []

    capability_task = capability_group.tasks[0]
    assert capability_task.hierarchy == "capability"
    assert capability_task.capability == "Random_Number_Generator"

    # Check visualization task group
    viz_group = next(tg for tg in campaign.task_groups if tg.id == "visualization_group")
    assert len(viz_group.tasks) == 1
    assert "capability_group" in viz_group.group_dependencies

    viz_task = viz_group.tasks[0]
    assert viz_task.hierarchy == "visualization"
    assert viz_task.capability == "Visualization"


def test_campaign_model_validation():
    """Test Campaign model validation with minimal valid data."""
    campaign_data = {
        "id": "test-campaign-001",
        "name": "Test Campaign",
        "user": "test_user",
        "description": "A test campaign",
        "task_groups": [],
    }

    campaign = Campaign(**campaign_data)
    assert campaign.id == "test-campaign-001"
    assert campaign.name == "Test Campaign"
    assert campaign.user == "test_user"
    assert campaign.description == "A test campaign"
    assert campaign.task_groups == []
    assert campaign.objectives is None
    assert campaign.inputs == []
    assert campaign.outputs == []


def test_campaign_run_id_defaults_to_uuidv4():
    """Test Campaign generates a run_id when existing campaign data omits it."""
    campaign = Campaign(
        id="test-campaign-001",
        name="Test Campaign",
        user="test_user",
        description="A test campaign",
        task_groups=[],
    )

    parsed_run_id = uuid.UUID(campaign.run_id)
    assert parsed_run_id.version == 4


def test_campaign_run_id_must_be_uuidv4():
    """Test Campaign rejects invalid and non-v4 run_id values."""
    campaign_data = {
        "id": "test-campaign-001",
        "name": "Test Campaign",
        "user": "test_user",
        "description": "A test campaign",
        "task_groups": [],
    }
    run_id = str(uuid.uuid4())

    campaign = Campaign(**campaign_data, run_id=run_id)
    assert campaign.run_id == run_id

    with pytest.raises(ValidationError, match="run_id must be a valid uuidv4"):
        Campaign(**campaign_data, run_id="not-a-uuid")

    with pytest.raises(ValidationError, match="run_id must be a valid uuidv4"):
        Campaign(**campaign_data, run_id=str(uuid.uuid1()))


def test_campaign_with_task_group():
    """Test Campaign model with a simple task group."""
    campaign_data = {
        "id": "test-campaign-002",
        "name": "Campaign with Tasks",
        "user": "test_user",
        "description": "A campaign with tasks",
        "task_groups": [
            {
                "id": "group_1",
                "group_dependencies": [],
                "tasks": [
                    {
                        "id": "task_1",
                        "hierarchy": "capability",
                        "capability": "TestCapability",
                        "operation_id": "test_operation",
                    }
                ],
                "objectives": [],
            }
        ],
    }

    campaign = Campaign(**campaign_data)
    assert len(campaign.task_groups) == 1
    assert campaign.task_groups[0].id == "group_1"
    assert len(campaign.task_groups[0].tasks) == 1
    assert campaign.task_groups[0].tasks[0].id == "task_1"


def test_task_with_input_and_output():
    """Test Task model with input and output schemas."""
    task_data = {
        "id": "task_with_io",
        "hierarchy": "capability",
        "capability": "DataProcessor",
        "operation_id": "process_data",
        "input": {
            "schema": {
                "type": "object",
                "properties": {
                    "data": {"type": "string", "description": "Input data"},
                    "count": {"type": "integer", "minimum": 0},
                },
            },
            "values": [
                {"id": "data_input", "var": "data"},
                {"id": "count_input", "var": "count"},
            ],
        },
        "output": {
            "schema": {
                "type": "object",
                "properties": {"result": {"type": "string", "description": "Processed result"}},
            },
            "values": [{"id": "result_output", "var": "result"}],
        },
    }

    task = Task(**task_data)
    assert task.id == "task_with_io"
    assert task.input is not None
    assert len(task.input.values) == 2
    assert task.output is not None
    assert len(task.output.values) == 1


def test_task_group_dependencies():
    """Test TaskGroup model with dependencies."""
    task_group_data = {
        "id": "dependent_group",
        "group_dependencies": ["group_1", "group_2"],
        "tasks": [
            {
                "id": "dependent_task",
                "hierarchy": "visualization",
                "capability": "Visualizer",
                "operation_id": "create_viz",
            }
        ],
        "objectives": [],
    }

    task_group = TaskGroup(**task_group_data)
    assert task_group.id == "dependent_group"
    assert len(task_group.group_dependencies) == 2
    assert "group_1" in task_group.group_dependencies
    assert "group_2" in task_group.group_dependencies


def test_task_with_task_dependencies():
    """Test Task model with task-level dependencies."""
    task_data = {
        "id": "dependent_task",
        "hierarchy": "capability",
        "capability": "DataMerger",
        "operation_id": "merge_data",
        "task_dependencies": ["task_1", "task_2"],
    }

    task = Task(**task_data)
    assert task.id == "dependent_task"
    assert len(task.task_dependencies) == 2
    assert "task_1" in task.task_dependencies
    assert "task_2" in task.task_dependencies


def test_event_task_mode_and_count_validation():
    once = Task(
        id="event-once",
        hierarchy="service",
        capability="Sensor",
        event_name="temperature",
    )
    counted = Task(
        id="event-count",
        hierarchy="service",
        capability="Sensor",
        event_name="temperature",
        event_mode="count",
        event_count=3,
    )

    assert once.model_dump()["event_mode"] == "once"
    assert counted.event_count == 3

    with pytest.raises(ValidationError, match="positive event_count"):
        Task(
            id="invalid-count",
            hierarchy="service",
            capability="Sensor",
            event_name="temperature",
            event_mode="count",
            event_count=0,
        )

    with pytest.raises(ValidationError, match="only valid for count"):
        Task(
            id="invalid-once",
            hierarchy="service",
            capability="Sensor",
            event_name="temperature",
            event_count=2,
        )

    with pytest.raises(ValidationError, match="operation tasks must use"):
        Task(
            id="invalid-operation",
            hierarchy="service",
            capability="Sensor",
            operation_id="sample",
            event_mode="persistent",
        )


def test_task_requires_operation_id_or_event_name():
    """Test that Task must have either operation_id or event_name, but not both."""
    # Test with neither - should fail
    with pytest.raises(ValidationError) as exc_info:
        Task(
            id="invalid_task",
            hierarchy="capability",
            capability="TestCap",
        )
    assert "needs to define exactly one of operation_id or event_name" in str(exc_info.value)

    # Test with both - should fail
    with pytest.raises(ValidationError) as exc_info:
        Task(
            id="invalid_task",
            hierarchy="capability",
            capability="TestCap",
            operation_id="test_op",
            event_name="test_event",
        )
    assert "needs to define exactly one of operation_id or event_name" in str(exc_info.value)

    # Test with operation_id only - should succeed
    task1 = Task(
        id="valid_task_1",
        hierarchy="capability",
        capability="TestCap",
        operation_id="test_op",
    )
    assert task1.operation_id == "test_op"
    assert task1.event_name is None

    # Test with event_name only - should succeed
    task2 = Task(
        id="valid_task_2",
        hierarchy="capability",
        capability="TestCap",
        event_name="test_event",
    )
    assert task2.event_name == "test_event"
    assert task2.operation_id is None


def test_value_model():
    """Test the Value model."""
    value_data = {"id": "test_value", "var": "test_variable"}
    value = Value(**value_data)
    assert value.id == "test_value"
    assert value.var == "test_variable"


def test_input_schema_validation():
    """Test Input model with schema validation."""
    input_data = {
        "schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "age": {"type": "integer", "minimum": 0},
            },
            "required": ["name"],
        },
        "values": [{"id": "name_val", "var": "name"}],
    }

    input_obj = Input(**input_data)
    assert "name" in input_obj.json_schema["properties"]
    assert "age" in input_obj.json_schema["properties"]
    assert input_obj.json_schema["required"] == ["name"]


def test_output_schema_validation():
    """Test Output model with schema validation."""
    output_data = {
        "schema": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["success", "failure"]},
                "message": {"type": "string"},
            },
        },
        "values": [
            {"id": "status_val", "var": "status"},
            {"id": "message_val", "var": "message"},
        ],
    }

    output_obj = Output(**output_data)
    assert "status" in output_obj.json_schema["properties"]
    assert "message" in output_obj.json_schema["properties"]


def test_campaign_serialization():
    """Test that Campaign can be serialized and deserialized."""
    campaign_data = {
        "id": "serialize-test",
        "name": "Serialization Test",
        "user": "test_user",
        "description": "Testing serialization",
        "task_groups": [
            {
                "id": "group_1",
                "tasks": [
                    {
                        "id": "task_1",
                        "hierarchy": "capability",
                        "capability": "TestCap",
                        "operation_id": "test_op",
                    }
                ],
            }
        ],
    }

    # Create campaign from dict
    campaign = Campaign(**campaign_data)

    # Serialize to dict
    campaign_dict = campaign.model_dump(by_alias=True)
    assert campaign_dict["id"] == "serialize-test"
    assert campaign_dict["name"] == "Serialization Test"

    # Deserialize back to Campaign
    campaign2 = Campaign(**campaign_dict)
    assert campaign2.id == campaign.id
    assert campaign2.name == campaign.name
    assert len(campaign2.task_groups) == len(campaign.task_groups)


def test_campaign_json_serialization():
    """Test that Campaign can be serialized to JSON."""
    campaign_data = {
        "id": "json-test",
        "name": "JSON Test",
        "user": "test_user",
        "description": "Testing JSON serialization",
        "task_groups": [],
    }

    campaign = Campaign(**campaign_data)

    # Serialize to JSON
    json_str = campaign.model_dump_json(by_alias=True)
    assert isinstance(json_str, str)
    assert "json-test" in json_str

    # Deserialize from JSON
    campaign_from_json = Campaign.model_validate_json(json_str)
    assert campaign_from_json.id == campaign.id
    assert campaign_from_json.name == campaign.name


def test_empty_task_groups():
    """Test Campaign with empty task groups list."""
    campaign_data = {
        "id": "empty-groups",
        "name": "Empty Groups",
        "user": "test_user",
        "description": "Campaign with no task groups",
        "task_groups": [],
    }

    campaign = Campaign(**campaign_data)
    assert campaign.task_groups == []
    assert isinstance(campaign.task_groups, list)


def test_task_with_none_input_output():
    """Test Task with None input and output."""
    task_data = {
        "id": "simple_task",
        "hierarchy": "visualization",
        "capability": "SimpleViz",
        "operation_id": "create_simple_viz",
        "input": None,
        "output": None,
    }

    task = Task(**task_data)
    assert task.input is None
    assert task.output is None


def test_input_requires_at_least_one_value():
    """Test that Input requires at least one value."""
    with pytest.raises(ValidationError):
        Input(
            schema={
                "type": "object",
                "properties": {"test": {"type": "string"}},
            },
            values=[],  # Empty values list should fail
        )


def test_output_requires_at_least_one_value():
    """Test that Output requires at least one value."""
    with pytest.raises(ValidationError):
        Output(
            schema={
                "type": "object",
                "properties": {"test": {"type": "string"}},
            },
            values=[],  # Empty values list should fail
        )


def test_complex_campaign_structure(random_number_and_histogram_campaign):
    """Test a more complex campaign structure with multiple groups and dependencies."""
    with Path.open(random_number_and_histogram_campaign) as f:
        data = json.load(f)

    campaign = Campaign(**data)

    # Verify the structure
    assert len(campaign.task_groups) == 2

    # Get groups by ID
    groups_by_id = {tg.id: tg for tg in campaign.task_groups}
    assert "capability_group" in groups_by_id
    assert "visualization_group" in groups_by_id

    # Verify dependencies
    viz_group = groups_by_id["visualization_group"]
    assert "capability_group" in viz_group.group_dependencies

    # Verify capability group has no dependencies
    cap_group = groups_by_id["capability_group"]
    assert cap_group.group_dependencies == []


def test_campaign_model_dump_with_alias():
    """Test that model_dump respects field aliases."""
    input_data = {
        "schema": {"type": "object", "properties": {"test": {"type": "string"}}},
        "values": [{"id": "test_val", "var": "test"}],
    }

    input_obj = Input(**input_data)

    # Dump with alias should use 'schema' not 'json_schema'
    dumped = input_obj.model_dump(by_alias=True)
    assert "schema" in dumped
    assert "json_schema" not in dumped

    # Dump without alias should use 'json_schema'
    dumped_no_alias = input_obj.model_dump(by_alias=False)
    assert "json_schema" in dumped_no_alias
    assert "schema" not in dumped_no_alias
