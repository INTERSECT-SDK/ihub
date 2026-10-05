"""Factory for building agent graphs from agent definitions."""

from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING
from uuid import UUID

from langchain.chat_models import init_chat_model
from langchain_ollama import ChatOllama
from sqlmodel import Session

from ihub_server.db import engine
from ihub_server.models import Agent
from ihub_server.services.errors import NotFoundError
from ihub_server.services.llm import LLMService

from .graph_builder import get_graph_builder
from .memory_store import MemoryStore
from .tool_registry import ToolRegistry

if TYPE_CHECKING:
    from langgraph.graph import StateGraph

_log = logging.getLogger("ihub-server")


class AgentFactory:
    """Factory for building agent graphs from agent definitions."""

    def __init__(
        self,
        tool_registry: ToolRegistry | None = None,
        memory_store: MemoryStore | None = None,
    ):
        """Initialize agent factory."""
        self.tool_registry = tool_registry or ToolRegistry()
        self.memory_store = memory_store or MemoryStore()

    def build(
        self,
        agent_def: Agent,
        conversation_id: str,
        runtime_overrides: dict | None = None,
    ) -> StateGraph:
        """Build a graph from an agent definition.

        Args:
            agent_def: Agent definition from database
            conversation_id: Unique conversation identifier
            runtime_overrides: Optional one-off runtime graph configuration

        Returns:
            Compiled LangGraph state graph
        """
        # Build LLM
        _log.info(f"Building LLM for model_id={agent_def.model_id}")
        llm = self._build_llm(agent_def.model_id)
        _log.info("LLM built successfully")

        # Resolve tools (skip for now if no tools)
        disable_tools = bool((runtime_overrides or {}).get("disable_tools"))
        tools = []
        if agent_def.tool_ids and not disable_tools:
            try:
                _log.info(f"Resolving {len(agent_def.tool_ids)} tools")
                tools = self.tool_registry.resolve_many(agent_def.tool_ids)
            except KeyError as e:
                _log.warning(f"Failed to resolve tools: {e}. Continuing without tools.")

        # Get memory
        _log.info(f"Getting memory with type={agent_def.memory_type}")
        memory = self.memory_store.get_memory(
            agent_def.memory_type,
            conversation_id,
        )
        _log.info("Memory initialized")

        # Get graph builder
        _log.info(f"Getting graph builder for graph_type={agent_def.graph_type}")
        graph_builder = get_graph_builder(agent_def.graph_type)
        if not graph_builder:
            msg = f"Graph builder not found for type '{agent_def.graph_type}'"
            raise ValueError(msg)
        _log.info("Graph builder retrieved")

        # Build graph
        _log.info(f"Building graph with system_prompt={agent_def.system_prompt[:50]}...")
        runtime_config = dict(agent_def.runtime_config or {})
        if runtime_overrides:
            runtime_config.update(runtime_overrides)

        selected_supervisor = None
        if agent_def.graph_type == "supervisor":
            runtime_config = self._hydrate_supervisor_runtime_config(
                runtime_config,
                disable_tools=disable_tools,
            )
            selected_supervisor = runtime_config.get("resolved_supervisor")

        selected_llm = llm
        selected_tools = tools
        selected_system_prompt = agent_def.system_prompt
        if isinstance(selected_supervisor, dict):
            selected_llm = selected_supervisor.get("llm", llm)
            selected_tools = selected_supervisor.get("tools", tools)
            selected_system_prompt = selected_supervisor.get(
                "system_prompt",
                agent_def.system_prompt,
            )

        graph = graph_builder(
            llm=selected_llm,
            tools=selected_tools,
            memory=memory,
            system_prompt=selected_system_prompt,
            config=runtime_config,
        )
        _log.info("Graph built successfully")

        return graph

    def _hydrate_supervisor_runtime_config(
        self,
        runtime_config: dict,
        *,
        disable_tools: bool = False,
    ) -> dict:
        """Resolve participant agents declared in runtime config.

        Expected runtime config key:
            participant_agent_ids: list[str] of existing agent UUIDs
        """
        participant_ids_raw = runtime_config.get("participant_agent_ids", [])
        if not isinstance(participant_ids_raw, list):
            participant_ids_raw = []

        supervisor_id_raw = runtime_config.get("supervisor_agent_id")

        resolved_participants: list[dict] = []
        resolved_supervisor: dict | None = None

        with Session(engine) as session:
            if supervisor_id_raw:
                try:
                    supervisor_id = UUID(str(supervisor_id_raw))
                except ValueError:
                    _log.warning("Skipping invalid supervisor agent id: %s", supervisor_id_raw)
                else:
                    supervisor = session.get(Agent, supervisor_id)
                    if not supervisor:
                        _log.warning("Supervisor agent not found: %s", supervisor_id)
                    elif supervisor.model_id is None:
                        _log.warning(
                            "Supervisor agent %s has no model_id; using base agent",
                            supervisor.id,
                        )
                    else:
                        try:
                            supervisor_llm = self._build_llm(supervisor.model_id)
                            supervisor_tools = []
                            if supervisor.tool_ids and not disable_tools:
                                try:
                                    supervisor_tools = self.tool_registry.resolve_many(
                                        supervisor.tool_ids,
                                    )
                                except KeyError as exc:
                                    _log.warning(
                                        "Failed to resolve supervisor tools for agent %s: %s. "
                                        "Continuing without tools.",
                                        supervisor.id,
                                        exc,
                                    )

                            resolved_supervisor = {
                                "agent_id": str(supervisor.id),
                                "name": supervisor.name,
                                "description": supervisor.description,
                                "system_prompt": supervisor.system_prompt,
                                "llm": supervisor_llm,
                                "tools": supervisor_tools,
                            }
                        except ValueError as exc:
                            _log.warning(
                                "Failed to build supervisor LLM for agent %s: %s. "
                                "Using base agent as supervisor.",
                                supervisor.id,
                                exc,
                            )

            for raw_id in participant_ids_raw:
                try:
                    participant_id = UUID(str(raw_id))
                except ValueError:
                    _log.warning("Skipping invalid participant agent id: %s", raw_id)
                    continue

                participant = session.get(Agent, participant_id)
                if not participant:
                    _log.warning("Participant agent not found: %s", participant_id)
                    continue

                if participant.model_id is None:
                    _log.warning(
                        "Participant agent %s has no model_id; skipping",
                        participant.id,
                    )
                    continue

                try:
                    participant_llm = self._build_llm(participant.model_id)
                except ValueError as exc:
                    _log.warning(
                        "Failed to build participant LLM for agent %s: %s",
                        participant.id,
                        exc,
                    )
                    continue

                participant_tools = []
                if participant.tool_ids and not disable_tools:
                    try:
                        participant_tools = self.tool_registry.resolve_many(participant.tool_ids)
                    except KeyError as exc:
                        _log.warning(
                            "Failed to resolve participant tools for agent %s: %s. "
                            "Continuing without tools.",
                            participant.id,
                            exc,
                        )

                resolved_participants.append(
                    {
                        "agent_id": str(participant.id),
                        "name": participant.name,
                        "description": participant.description,
                        "system_prompt": participant.system_prompt,
                        "llm": participant_llm,
                        "tools": participant_tools,
                    }
                )

        hydrated_config = dict(runtime_config)
        if resolved_supervisor:
            hydrated_config["resolved_supervisor"] = resolved_supervisor
            hydrated_config["supervisor_name"] = str(resolved_supervisor["name"])
            hydrated_config["supervisor_target_id"] = str(resolved_supervisor["agent_id"])
        hydrated_config["resolved_participants"] = resolved_participants
        return hydrated_config

    def _build_llm(self, model_id: int | None):
        """Build LLM client from model_id.

        Args:
            model_id: LLM model ID (references LLM table)

        Returns:
            Initialized LLM client

        Raises:
            ValueError: If LLM with given id not found or provider not supported
        """
        if model_id is None:
            msg = "Agent does not have a model_id configured"
            raise ValueError(msg)

        with Session(engine) as session:
            try:
                llm_config = LLMService(session).get_llm(model_id)
            except NotFoundError:
                msg = f"LLM with id {model_id} not found"
                raise ValueError(msg) from None

            model_name = self._sanitize_setting(llm_config.model)
            endpoint_url = self._sanitize_setting(llm_config.url)

            if llm_config.provider == "ollama":
                if not endpoint_url:
                    msg = "Missing Ollama URL"
                    raise ValueError(msg)
                if not model_name:
                    msg = "Missing model name"
                    raise ValueError(msg)

                return ChatOllama(
                    model=model_name,
                    base_url=endpoint_url,
                    temperature=0.0,
                )

            if llm_config.provider == "azure":
                api_key = self._sanitize_setting(llm_config.api_key)
                api_version = self._sanitize_setting(llm_config.api_version)
                deployment_name = self._sanitize_setting(llm_config.deployment_name)

                if not api_key:
                    msg = "Missing API key"
                    raise ValueError(msg)

                if not api_version:
                    msg = "Missing API Version"
                    raise ValueError(msg)

                if not deployment_name:
                    msg = "Missing Azure Deployment Name"
                    raise ValueError(msg)

                if not endpoint_url:
                    msg = "Missing Azure Endpoint URL"
                    raise ValueError(msg)

                if not model_name:
                    msg = "Missing model name"
                    raise ValueError(msg)

                os.environ["AZURE_OPENAI_API_KEY"] = api_key
                os.environ["AZURE_OPENAI_ENDPOINT"] = endpoint_url
                os.environ["OPENAI_API_VERSION"] = api_version

                return init_chat_model(
                    f"azure_openai:{model_name}",
                    azure_deployment=deployment_name,
                    temperature=0,
                )

            msg = f"Provider {llm_config.provider} not supported yet"
            raise ValueError(msg)

    def _sanitize_setting(self, value: str | None) -> str:
        """Normalize persisted setting values by removing control chars."""
        if not value:
            return ""

        return str(value).replace("\r", "").replace("\n", "").replace("\t", "").strip()
