"""Service to manage Flowcept broker connections and message persistence."""

from flowcept.flowcept_api.flowcept_controller import Flowcept
from flowcept.instrumentation.task_capture import FlowceptTask
from sqlmodel import Session

from ihub_server.repositories import flowcept_messages as flowcept_repository
from ihub_server.services.errors import ConflictError
from ihub_server.utils.flowcept import AgentConsumer


class FlowceptService:
    def __init__(self, session: Session) -> None:
        self._session = session

    def connect_broker(self, app_state) -> None:
        if hasattr(app_state, "s3m_consumer"):
            msg = "Consumer already created."
            raise ConflictError(msg)

        consumer = AgentConsumer(save=True)
        consumer.start(daemon=False)
        app_state.s3m_consumer = consumer

    def disconnect_broker(self, app_state) -> None:
        if not hasattr(app_state, "s3m_consumer"):
            msg = "Consumer does not exist. Try connecting first."
            raise ConflictError(msg)

        consumer = app_state.s3m_consumer
        delattr(app_state, "s3m_consumer")
        consumer.stop_consumption()

    def check_connection(self, app_state) -> bool:
        if not hasattr(app_state, "s3m_consumer"):
            msg = "Consumer does not exist. Try connecting first."
            raise ConflictError(msg)

        consumer = app_state.s3m_consumer
        return consumer._mq_dao.liveness_test()  # noqa: SLF001

    def list_messages(self, offset: int, limit: int):
        return flowcept_repository.list_messages(self._session, offset, limit)

    def list_messages_by_activity(self, activity_id: str, offset: int, limit: int):
        return flowcept_repository.list_messages_by_activity(
            self._session,
            activity_id,
            offset,
            limit,
        )

    def send_message(self, payload: dict) -> None:
        with Flowcept(
            workflow_id="agent_workflow",
            save_workflow=False,
            start_persistence=False,
            check_safe_stops=False,
        ):
            ft = FlowceptTask(
                agent_id="HMI_agent",
                subtype="agent_task",
                activity_id="hmi_message",
                used=payload,
            )
            ft.end()

    def send_hmi_message(self, activity_id: str, payload: dict) -> None:
        with Flowcept(
            workflow_id="agent_workflow",
            save_workflow=False,
            start_persistence=False,
            check_safe_stops=False,
        ):
            ft = FlowceptTask(
                agent_id="HMI_agent",
                subtype="agent_task",
                activity_id=activity_id,
                used=payload,
            )
            ft.end()
