from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from flowcept.commons.flowcept_dataclasses.task_object import TaskObject
from flowcept.flowceptor.consumers.base_consumer import BaseConsumer
from sqlmodel import Session

from ihub_server.db import SessionDep, engine
from ihub_server.models import FlowceptMessage

_log = logging.getLogger("ihub-server")


class AgentConsumer(BaseConsumer):
    def __init__(self, save: bool = False):
        super().__init__()
        self._save = save

    def message_handler(self, msg_obj: dict) -> bool:
        if msg_obj.get("type") != "task":
            _log.info(f"Message is not a 'task' type: {msg_obj.get('type')}")
            return True

        msg = TaskObject.from_dict(msg_obj)
        allowed_msg_subtypes = ["agent_task"]
        if msg.subtype not in allowed_msg_subtypes:
            _log.info(f"Message not an target task, not saving to database: {msg.subtype}")
            return True

        _log.info(msg)
        # _log.info(msg_obj)

        if self._save:
            parsed_msg = parse_flowcept_message(msg, msg_obj)
            create_flowcept_message(msg=parsed_msg, session=Session(engine))

        # Save message to database
        return True


@dataclass
class ParsedFlowceptMessage:
    activity_id: str
    campaign_id: str
    created_at: datetime
    message: dict[str, Any]


def parse_flowcept_message(msg: TaskObject, raw_msg: dict[str, Any]) -> ParsedFlowceptMessage:
    """Parse the broker message"""
    activity_id: str = str(msg.activity_id)
    campaign_id: str = str(msg.campaign_id)

    epoch_timestamp = msg.started_at
    dt_obj = datetime.fromtimestamp(epoch_timestamp, tz=UTC)

    info = ParsedFlowceptMessage(
        activity_id=activity_id, campaign_id=campaign_id, created_at=dt_obj, message=raw_msg
    )

    return info


def create_flowcept_message(msg: ParsedFlowceptMessage, session: SessionDep) -> FlowceptMessage:
    """Save parsed flowcept message to the database"""
    db_msg = FlowceptMessage.model_validate(msg)
    session.add(db_msg)
    session.commit()
    session.refresh(db_msg)
    _log.info(f"saved flowcept message {db_msg.activity_id} to database")
    return db_msg
