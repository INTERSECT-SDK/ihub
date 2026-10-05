from fastapi import APIRouter

from .endpoints import (
    agents,
    auth,
    brokers,
    campaign,
    capabilities,
    chat,
    contents,
    flowcept,
    general,
    jupyter_servers,
    jupyterhub,
    llm,
    mcp_servers,
    messages,
    projects,
    remote_agent_servers,
    services,
    tools,
)

router = APIRouter(prefix="/v1")
router.include_router(agents.router, prefix="/agents", tags=["Agents"])
router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
router.include_router(brokers.router, prefix="/brokers", tags=["Brokers"])
router.include_router(capabilities.router, prefix="/capabilities", tags=["Capabilities"])
router.include_router(campaign.router, prefix="/campaign", tags=["Campaign"])
router.include_router(chat.router, prefix="/chat", tags=["Chat"])
router.include_router(contents.router, prefix="/contents", tags=["Contents"])
router.include_router(flowcept.router, prefix="/flowcept", tags=["Flowcept"])
router.include_router(general.router)
router.include_router(jupyter_servers.router, prefix="/jupyter", tags=["Jupyter Servers"])
router.include_router(jupyterhub.router, prefix="/jupyterhub", tags=["JupyterHub"])
router.include_router(llm.router, prefix="/llm", tags=["LLM"])
router.include_router(mcp_servers.router, prefix="/mcp_servers", tags=["MCP Servers"])
router.include_router(messages.router, prefix="/messages", tags=["Messages"])
router.include_router(projects.router, prefix="/projects", tags=["Projects"])
router.include_router(services.router, prefix="/services", tags=["Services"])
router.include_router(
    remote_agent_servers.router,
    prefix="/remote_agent_servers",
    tags=["Remote Agent Servers"],
)
router.include_router(tools.router, prefix="/tools", tags=["Tools"])
