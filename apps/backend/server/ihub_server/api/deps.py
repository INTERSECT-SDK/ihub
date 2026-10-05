from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException
from starlette.requests import HTTPConnection

from ihub_server.db import SessionDep, UserDep, create_session, validate_user_session
from ihub_server.services.agents import AgentService
from ihub_server.services.auth import AuthService
from ihub_server.services.brokers import (
    BrokerConnectionService,
    BrokerOrchestratorHealthService,
    BrokerService,
)
from ihub_server.services.campaign import CampaignService
from ihub_server.services.campaign_events import CampaignEventManager
from ihub_server.services.campaign_runs import CampaignRunService
from ihub_server.services.campaign_transport import OrchestratorCampaignTransport
from ihub_server.services.capabilities import CapabilityService
from ihub_server.services.chat import ChatService
from ihub_server.services.contents import ContentService
from ihub_server.services.flowcept import FlowceptService
from ihub_server.services.healthcheck import HealthcheckService
from ihub_server.services.jupyter_servers import JupyterServerService
from ihub_server.services.jupyterhub import JupyterHubService
from ihub_server.services.lifecycle import LifecycleMessageService
from ihub_server.services.llm import LLMService
from ihub_server.services.mcp_servers import MCPServerService
from ihub_server.services.orchestrator import OrchestratorService
from ihub_server.services.orchestrator_events import OrchestratorEventService
from ihub_server.services.projects import ProjectService
from ihub_server.services.remote_agent_servers import RemoteAgentServerService
from ihub_server.services.services import ServiceService
from ihub_server.services.upload_locks import UploadLockManager


@dataclass(frozen=True)
class Principal:
    """Normalized authenticated caller identity for API dependencies."""

    subject_id: str
    email: str


@dataclass(frozen=True)
class ProjectUploadDependencies:
    """Application services used only by project-file uploads."""

    project_service: ProjectService
    lock_manager: UploadLockManager


def get_principal(user: UserDep) -> Principal:
    """Build a normalized principal from the authenticated user session."""
    validated_user = validate_user_session(user)
    if validated_user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    subject_id = str(validated_user.get("subject_id") or validated_user.get("sub") or "").strip()
    email = str(validated_user.get("email") or "").strip().lower()

    if not subject_id or not email:
        raise HTTPException(status_code=401, detail="Invalid user session")

    return Principal(subject_id=subject_id, email=email)


def get_broker_service(session: SessionDep) -> BrokerService:
    """Create a broker service bound to the current database session."""
    return BrokerService(session)


def get_broker_connection_service(
    connection: HTTPConnection,
    broker_service: Annotated[BrokerService, Depends(get_broker_service)],
) -> BrokerConnectionService:
    """Create the broker connection service with broker and session dependencies."""
    return BrokerConnectionService(
        broker_service=broker_service,
        session_factory=create_session,
        lifecycle_publisher=connection.app.state.lifecycle_message_stream.publish,
    )


def get_broker_orchestrator_health_service(
    broker_service: Annotated[BrokerService, Depends(get_broker_service)],
) -> BrokerOrchestratorHealthService:
    """Create the read-only orchestrator health service."""
    return BrokerOrchestratorHealthService(broker_service)


def get_service_service(session: SessionDep) -> ServiceService:
    """Create a service registry service bound to the current database session."""
    return ServiceService(session)


def get_capability_service(session: SessionDep) -> CapabilityService:
    """Create a capability service bound to the current database session."""
    return CapabilityService(session)


def get_lifecycle_message_service(session: SessionDep) -> LifecycleMessageService:
    """Create a lifecycle message service bound to the current database session."""
    return LifecycleMessageService(session)


def get_agent_service(session: SessionDep) -> AgentService:
    """Create an agent service bound to the current database session."""
    return AgentService(session)


def get_remote_agent_service(session: SessionDep) -> RemoteAgentServerService:
    """Create a remote agent server service for the current database session."""
    return RemoteAgentServerService(session)


def get_chat_service(
    agent_service: Annotated[AgentService, Depends(get_agent_service)],
    remote_agent_service: Annotated[
        RemoteAgentServerService,
        Depends(get_remote_agent_service),
    ],
) -> ChatService:
    """Create a chat service from local and remote agent dependencies."""
    return ChatService(agent_service, remote_agent_service)


def get_jupyter_server_service(session: SessionDep) -> JupyterServerService:
    """Create a Jupyter server service bound to the current database session."""
    return JupyterServerService(session)


def get_content_service() -> ContentService:
    """Create a content service for proxying JupyterHub contents requests."""
    return ContentService()


def get_upload_lock_manager(connection: HTTPConnection) -> UploadLockManager:
    """Return the application-lifetime project upload lock manager."""
    return connection.app.state.upload_lock_manager


def get_flowcept_service(session: SessionDep) -> FlowceptService:
    """Create a Flowcept service bound to the current database session."""
    return FlowceptService(session)


def get_llm_service(session: SessionDep) -> LLMService:
    """Create an LLM service bound to the current database session."""
    return LLMService(session)


def get_mcp_server_service(session: SessionDep) -> MCPServerService:
    """Create an MCP server service bound to the current database session."""
    return MCPServerService(session)


def get_orchestrator_event_service(session: SessionDep) -> OrchestratorEventService:
    """Create an orchestrator event service for the current database session."""
    return OrchestratorEventService(session)


def get_campaign_run_service(session: SessionDep) -> CampaignRunService:
    """Create a campaign run service bound to the current database session."""
    return CampaignRunService(session)


def get_campaign_event_manager(connection: HTTPConnection) -> CampaignEventManager:
    """Return the application-lifetime campaign event manager."""
    return connection.app.state.campaign_event_manager


def get_campaign_service(
    broker_service: Annotated[BrokerService, Depends(get_broker_service)],
    event_service: Annotated[OrchestratorEventService, Depends(get_orchestrator_event_service)],
    service_service: Annotated[ServiceService, Depends(get_service_service)],
    run_service: Annotated[CampaignRunService, Depends(get_campaign_run_service)],
    event_manager: Annotated[CampaignEventManager, Depends(get_campaign_event_manager)],
) -> CampaignService:
    """Create a campaign service from broker, event, and service dependencies."""
    return CampaignService(
        broker_service,
        event_service,
        service_service,
        run_service,
        event_manager,
        transport=OrchestratorCampaignTransport(),
    )


def get_jupyterhub_service() -> JupyterHubService:
    """Create a JupyterHub integration service."""
    return JupyterHubService()


def get_healthcheck_service() -> HealthcheckService:
    """Create a healthcheck service."""
    return HealthcheckService()


def get_orchestrator_service() -> OrchestratorService:
    """Create an orchestrator service."""
    return OrchestratorService()


def get_auth_service(session: SessionDep) -> AuthService:
    """Create an authentication service bound to the current database session."""
    return AuthService(session)


def get_project_service(session: SessionDep) -> ProjectService:
    """Create a project service bound to the current database session."""
    return ProjectService(session)


def get_project_upload_dependencies(
    project_service: Annotated[ProjectService, Depends(get_project_service)],
    lock_manager: Annotated[UploadLockManager, Depends(get_upload_lock_manager)],
) -> ProjectUploadDependencies:
    """Bundle project authorization and target-lock services for uploads."""
    return ProjectUploadDependencies(project_service, lock_manager)


BrokerServiceDep = Annotated[BrokerService, Depends(get_broker_service)]
BrokerConnectionServiceDep = Annotated[
    BrokerConnectionService, Depends(get_broker_connection_service)
]
ServiceServiceDep = Annotated[ServiceService, Depends(get_service_service)]
CapabilityServiceDep = Annotated[CapabilityService, Depends(get_capability_service)]
LifecycleMessageServiceDep = Annotated[
    LifecycleMessageService, Depends(get_lifecycle_message_service)
]
AgentServiceDep = Annotated[AgentService, Depends(get_agent_service)]
ChatServiceDep = Annotated[ChatService, Depends(get_chat_service)]
JupyterServerServiceDep = Annotated[JupyterServerService, Depends(get_jupyter_server_service)]
ContentServiceDep = Annotated[ContentService, Depends(get_content_service)]
UploadLockManagerDep = Annotated[UploadLockManager, Depends(get_upload_lock_manager)]
FlowceptServiceDep = Annotated[FlowceptService, Depends(get_flowcept_service)]
LLMServiceDep = Annotated[LLMService, Depends(get_llm_service)]
MCPServerServiceDep = Annotated[MCPServerService, Depends(get_mcp_server_service)]
RemoteAgentServerServiceDep = Annotated[
    RemoteAgentServerService,
    Depends(get_remote_agent_service),
]
OrchestratorEventServiceDep = Annotated[
    OrchestratorEventService, Depends(get_orchestrator_event_service)
]
CampaignServiceDep = Annotated[CampaignService, Depends(get_campaign_service)]
CampaignRunServiceDep = Annotated[CampaignRunService, Depends(get_campaign_run_service)]
JupyterHubServiceDep = Annotated[JupyterHubService, Depends(get_jupyterhub_service)]
HealthcheckServiceDep = Annotated[HealthcheckService, Depends(get_healthcheck_service)]
OrchestratorServiceDep = Annotated[OrchestratorService, Depends(get_orchestrator_service)]
AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]
ProjectServiceDep = Annotated[ProjectService, Depends(get_project_service)]
ProjectUploadDependenciesDep = Annotated[
    ProjectUploadDependencies, Depends(get_project_upload_dependencies)
]
PrincipalDep = Annotated[Principal, Depends(get_principal)]
