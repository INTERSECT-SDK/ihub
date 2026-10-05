# agents/graph_builders.py

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Annotated, Any, TypedDict, cast

from langchain_core.language_models import BaseLanguageModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

if TYPE_CHECKING:
    from collections.abc import Callable, Hashable

    from langchain_community.chat_message_histories import ChatMessageHistory

_log = logging.getLogger("ihub-server")

GRAPH_BUILDERS: dict[str, Callable[..., Any]] = {}


class BasicState(TypedDict):
    messages: list[BaseMessage]


class ReactState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


def _normalize_agent_key(name: str) -> str:
    """Create a stable key from an agent display name."""
    normalized = "".join(ch.lower() if ch.isalnum() else "_" for ch in name).strip("_")
    return normalized or "agent"


def _extract_mentioned_agent(
    content: str,
    mention_prefix: str,
    mention_candidates: list[str],
) -> str | None:
    """Parse a direct mention from the start of the message.

    Supports both short mentions (for example, @planner) and full names with
    spaces (for example, @Hypothesis Agent). The longest candidate wins.
    """
    stripped = content.strip()
    if not stripped.startswith(mention_prefix):
        return None

    mention_text = stripped[len(mention_prefix) :].lstrip().lower()
    if not mention_text:
        return None

    # Longest-prefix match so "hypothesis agent" beats "hypothesis".
    sorted_candidates = sorted(
        (candidate.strip().lower() for candidate in mention_candidates if candidate.strip()),
        key=len,
        reverse=True,
    )

    for candidate in sorted_candidates:
        if not mention_text.startswith(candidate):
            continue

        # Ensure the mention stops on a boundary, not in the middle of a word.
        remainder = mention_text[len(candidate) :]
        if not remainder:
            return candidate

        first_char = remainder[0]
        if first_char.isspace() or first_char in ":,.;!?)]}":
            return candidate

    return None


def _build_supervisor_spec(
    llm: BaseLanguageModel,
    tools: list[Any],
    system_prompt: str,
    participant_names: list[str],
) -> dict[str, Any]:
    """Build supervisor agent spec including prompt and tool binding."""
    supervisor_prompt_parts = [system_prompt.strip()]
    if participant_names:
        supervisor_prompt_parts.append(
            "You are the supervisor agent in a multi-agent room. "
            "When needed, decide whether to answer directly or call tools. "
            f"Available participant agents: {', '.join(participant_names)}."
        )
    supervisor_prompt = "\n\n".join(part for part in supervisor_prompt_parts if part)

    return {
        "llm": cast(Any, llm).bind_tools(tools) if tools else llm,
        "tools": tools,
        "system_prompt": supervisor_prompt,
    }


def _build_participant_spec(
    participant: dict[str, Any],
    default_llm: BaseLanguageModel,
) -> dict[str, Any]:
    """Build participant agent spec with fallback prompt and bound tools."""
    raw_name = str(participant.get("name", "")).strip()
    participant_llm = cast(BaseLanguageModel, participant.get("llm", default_llm))
    participant_tools = cast(list[Any], participant.get("tools", []))
    participant_prompt = str(participant.get("system_prompt", "")).strip()
    if not participant_prompt:
        participant_prompt = (
            f'You are "{raw_name}", a specialist participant in a multi-agent '
            "conversation. Answer only from this specialist's perspective."
        )

    return {
        "name": raw_name,
        "llm": cast(Any, participant_llm).bind_tools(participant_tools)
        if participant_tools
        else participant_llm,
        "tools": participant_tools,
        "system_prompt": participant_prompt,
    }


def _add_agent_node(
    graph_builder: StateGraph,
    node_name: str,
    agent_spec: dict[str, Any],
    memory: ChatMessageHistory | None,
) -> None:
    """Add one agent node and optional tool loop to graph."""

    def call_model(state: ReactState) -> dict[str, list[BaseMessage]]:
        messages = list(state["messages"])
        local_prompt = str(agent_spec.get("system_prompt", "")).strip()
        if local_prompt and (
            not messages
            or not isinstance(messages[0], SystemMessage)
            or messages[0].content != local_prompt
        ):
            messages = [SystemMessage(content=local_prompt), *messages]

        response = agent_spec["llm"].invoke(messages)

        if memory:
            if messages:
                memory.add_message(messages[-1])
            memory.add_message(response)

        return {"messages": [response]}

    graph_builder.add_node(node_name, call_model)  # type: ignore[arg-type]

    local_tools = cast(list[Any], agent_spec.get("tools", []))
    if not local_tools:
        graph_builder.add_edge(node_name, END)
        return

    tool_node_name = f"tools_{node_name.removeprefix('agent_')}"
    graph_builder.add_node(tool_node_name, ToolNode(local_tools))  # type: ignore[arg-type]

    def should_continue(state: ReactState) -> str:
        last = state["messages"][-1]
        if isinstance(last, AIMessage) and last.tool_calls:
            return "tools"
        return END

    graph_builder.add_conditional_edges(
        node_name,
        should_continue,
        {"tools": tool_node_name, END: END},
    )
    graph_builder.add_edge(tool_node_name, node_name)


def _build_agent_specs_and_lookup(
    llm: BaseLanguageModel,
    tools: list[Any],
    system_prompt: str,
    supervisor_name: str,
    supervisor_target_id: str,
    resolved_participants: list[dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], dict[str, str], dict[str, str]]:
    """Build specs and mention maps for supervisor + participants."""
    participant_names = [
        str(participant.get("name", "")).strip()
        for participant in resolved_participants
        if str(participant.get("name", "")).strip()
    ]

    supervisor_spec = _build_supervisor_spec(llm, tools, system_prompt, participant_names)
    supervisor_spec["name"] = supervisor_name

    agent_specs: dict[str, dict[str, Any]] = {"supervisor": supervisor_spec}
    mention_lookup: dict[str, str] = {
        supervisor_name.lower(): supervisor_target_id,
        "supervisor": supervisor_target_id,
    }
    target_id_to_agent_key: dict[str, str] = {supervisor_target_id: "supervisor"}

    for participant in resolved_participants:
        raw_name = str(participant.get("name", "")).strip()
        if not raw_name:
            continue

        base_key = _normalize_agent_key(raw_name)
        agent_key = base_key
        suffix = 1
        while agent_key in agent_specs:
            suffix += 1
            agent_key = f"{base_key}_{suffix}"

        agent_specs[agent_key] = _build_participant_spec(participant, llm)

        participant_id = str(participant.get("agent_id", "")).strip() or agent_key
        target_id_to_agent_key[participant_id] = agent_key

        mention_lookup[raw_name.lower()] = participant_id
        mention_lookup[agent_key.lower()] = participant_id

        for alias in cast(list[str], participant.get("aliases", [])):
            alias_normalized = alias.strip().lower()
            if alias_normalized:
                mention_lookup[alias_normalized] = participant_id

    return agent_specs, mention_lookup, target_id_to_agent_key


def _auto_select_worker_route(
    llm: BaseLanguageModel,
    user_text: str,
    worker_keys: list[str],
    worker_names: dict[str, str],
) -> str:
    """Use the LLM to pick a worker route, falling back to supervisor."""
    if not worker_keys:
        return "supervisor"

    worker_lines = [f"- {key}: {worker_names.get(key, key)}" for key in worker_keys]
    worker_block = "\n".join(worker_lines)
    routing_prompt = (
        "You are a routing controller for a multi-agent chat. "
        "Choose exactly one target for the next turn.\n"
        "Rules:\n"
        "1) Return exactly one token from this set: supervisor, "
        f"{', '.join(worker_keys)}\n"
        "2) Pick a worker only if the user's message is clearly specialist-"
        "specific.\n"
        "3) If unsure, return supervisor.\n"
        "Workers:\n"
        f"{worker_block}"
    )

    try:
        route_response = llm.invoke(
            [
                SystemMessage(content=routing_prompt),
                HumanMessage(content=user_text),
            ],
        )
        route_text = str(getattr(route_response, "content", "")).strip().lower()
    except (RuntimeError, ValueError, TypeError) as exc:
        _log.warning("Auto worker routing failed, falling back to supervisor: %s", exc)
        return "supervisor"

    if route_text in worker_keys:
        return route_text
    if route_text == "supervisor":
        return "supervisor"

    # Be tolerant if the model adds text around the token.
    for candidate in ["supervisor", *worker_keys]:
        if candidate in route_text:
            return candidate

    return "supervisor"


def register_graph_builder(name: str):
    """Decorator to register a graph builder."""

    def decorator(fn):
        GRAPH_BUILDERS[name] = fn
        _log.info(f"Registered graph builder: {name}")
        return fn

    return decorator


def get_graph_builder(name: str):
    """Get a registered graph builder by name."""
    return GRAPH_BUILDERS.get(name)


@register_graph_builder("basic")
def build_basic_graph(
    llm: BaseLanguageModel,
    tools: list[Any] | None = None,
    memory: ChatMessageHistory | None = None,
    system_prompt: str = "",
    config: dict | None = None,
) -> Any:
    """
    Build a basic conversational graph without tools.

    Args:
        llm: Language model to use
        tools: Tools (ignored for basic graph)
        memory: Chat message history
        system_prompt: System message for the LLM
        config: Runtime configuration

    Returns:
        Compiled LangGraph state graph
    """
    # Accepted for graph-builder API compatibility; currently unused.
    _ = config
    if tools is None:
        tools = []
    # Create graph
    graph_builder = StateGraph(BasicState)  # type: ignore[arg-type]

    # Define the chat node
    def chat_node(state: BasicState) -> dict:
        """Chat node that calls the LLM."""
        messages = state.get("messages", [])

        # Add system prompt if provided
        if system_prompt:
            messages = [SystemMessage(content=system_prompt), *messages]

        # Call LLM
        response = llm.invoke(messages)

        # Store in memory if available
        if memory:
            # Add last user message and response to memory
            if len(messages) > 0:
                memory.add_message(messages[-1])
            memory.add_message(response)

        # Return updated state with assistant message
        return {"messages": [*messages, response]}

    # Add nodes and edges
    graph_builder.add_node("chat", chat_node)  # type: ignore[arg-type]
    graph_builder.add_edge(START, "chat")

    # Compile graph
    graph = graph_builder.compile()
    _log.info("Basic graph compiled successfully")
    return graph


@register_graph_builder("react")
def build_react_graph(
    llm: BaseLanguageModel,
    tools: list[Any] | None = None,
    memory: ChatMessageHistory | None = None,
    system_prompt: str = "",
    config: dict | None = None,
) -> Any:
    """
    Build a ReAct-style graph that supports tool calling.

    The LLM decides whether to call tools; if it does, the tool is executed
    and the result is fed back to the LLM. This repeats until the LLM
    produces a final answer without tool calls.

    Args:
        llm: Language model to use (must support tool binding)
        tools: List of LangChain tools to make available
        memory: Chat message history
        system_prompt: System message for the LLM
        config: Runtime configuration

    Returns:
        Compiled LangGraph state graph
    """
    # Accepted for graph-builder API compatibility; currently unused.
    _ = config
    if tools is None:
        tools = []
    # Bind tools to LLM so it knows they exist and can emit tool_calls
    llm_with_tools = cast(Any, llm).bind_tools(tools) if tools else llm

    graph_builder = StateGraph(ReactState)  # type: ignore[arg-type]

    def call_model(state: ReactState) -> dict[str, list[BaseMessage]]:
        """Invoke the LLM, prepending the system prompt on every call."""
        messages = list(state["messages"])
        if system_prompt and (not messages or not isinstance(messages[0], SystemMessage)):
            messages = [SystemMessage(content=system_prompt), *messages]

        response = llm_with_tools.invoke(messages)

        if memory:
            if messages:
                memory.add_message(messages[-1])
            memory.add_message(response)

        # Return only the new message; add_messages appends it to state
        return {"messages": [response]}

    def should_continue(state: ReactState) -> str:
        """Route to tools if the LLM emitted tool calls, otherwise finish."""
        last = state["messages"][-1]
        if isinstance(last, AIMessage) and last.tool_calls:
            return "tools"
        return END

    graph_builder.add_node("agent", call_model)  # type: ignore[arg-type]

    if tools:
        graph_builder.add_node("tools", ToolNode(tools))  # type: ignore[arg-type]
        graph_builder.add_conditional_edges(
            "agent",
            should_continue,
            {"tools": "tools", END: END},
        )
        graph_builder.add_edge("tools", "agent")
    else:
        graph_builder.add_edge("agent", END)

    graph_builder.add_edge(START, "agent")

    graph = graph_builder.compile()
    _log.info("ReAct graph compiled successfully with %d tool(s)", len(tools))
    return graph


@register_graph_builder("supervisor")
def build_supervisor_graph(
    llm: BaseLanguageModel,
    tools: list[Any] | None = None,
    memory: ChatMessageHistory | None = None,
    system_prompt: str = "",
    config: dict | None = None,
) -> Any:
    """Build a supervisor-led multi-agent graph.

    This graph is backward-compatible with existing chat flows. By default,
    all user messages route to the supervisor. When enabled, users can direct
    a message to a specific participant with a mention (for example, @planner).

    Runtime config keys:
        resolved_participants: list[dict] hydrated by AgentFactory from DB agents
        supervisor_name: Optional display name for supervisor
        supervisor_target_id: Optional DB identifier for supervisor agent
        allow_direct_messages: Whether user mentions can target participants
        enable_auto_worker_routing: Let supervisor auto-route turns to workers
        prefer_tool_workers: Prefer tool-enabled workers for auto-routed turns
        direct_mention_prefix: Mention prefix, default "@"
    """
    if tools is None:
        tools = []
    if config is None:
        config = {}

    mention_prefix = str(config.get("direct_mention_prefix", "@"))
    allow_direct_messages = bool(config.get("allow_direct_messages", True))
    enable_auto_worker_routing = bool(config.get("enable_auto_worker_routing", True))
    prefer_tool_workers = bool(config.get("prefer_tool_workers", True))
    supervisor_name = str(config.get("supervisor_name", "supervisor")).strip() or "supervisor"
    supervisor_target_id = (
        str(config.get("supervisor_target_id", "supervisor")).strip() or "supervisor"
    )
    resolved_participants = cast(list[dict[str, Any]], config.get("resolved_participants", []))

    graph_builder = StateGraph(ReactState)  # type: ignore[arg-type]
    agent_specs, mention_lookup, target_id_to_agent_key = _build_agent_specs_and_lookup(
        llm=llm,
        tools=tools,
        system_prompt=system_prompt,
        supervisor_name=supervisor_name,
        supervisor_target_id=supervisor_target_id,
        resolved_participants=resolved_participants,
    )
    worker_keys = [agent_key for agent_key in agent_specs if agent_key != "supervisor"]
    worker_names = {
        agent_key: str(agent_specs[agent_key].get("name", agent_key)) for agent_key in worker_keys
    }
    tool_enabled_worker_keys = [
        agent_key
        for agent_key in worker_keys
        if cast(list[Any], agent_specs[agent_key].get("tools", []))
    ]

    def route_passthrough(_state: ReactState) -> dict[str, list[BaseMessage]]:
        """No-op node used only to run conditional routing."""
        return {"messages": []}

    def select_agent_route(state: ReactState) -> str:
        """Choose supervisor by default, participant only on direct mention."""
        if not state["messages"]:
            return "supervisor"

        last_message = state["messages"][-1]
        if allow_direct_messages and isinstance(last_message, HumanMessage):
            target = _extract_mentioned_agent(
                str(last_message.content),
                mention_prefix,
                list(mention_lookup.keys()),
            )
            if target and target in mention_lookup:
                target_id = mention_lookup[target]
                if target_id in target_id_to_agent_key:
                    return target_id_to_agent_key[target_id]

        if enable_auto_worker_routing and isinstance(last_message, HumanMessage):
            auto_route = _auto_select_worker_route(
                llm=llm,
                user_text=str(last_message.content),
                worker_keys=worker_keys,
                worker_names=worker_names,
            )

            # Keep direct ping priority, but otherwise actively use worker tool paths.
            if prefer_tool_workers and auto_route == "supervisor" and tool_enabled_worker_keys:
                auto_route = tool_enabled_worker_keys[0]

            if auto_route in route_map:
                return auto_route

        return "supervisor"

    graph_builder.add_node("route", route_passthrough)  # type: ignore[arg-type]

    route_map: dict[Hashable, str] = {}

    for agent_key, spec in agent_specs.items():
        node_name = f"agent_{agent_key}"
        route_map[agent_key] = node_name
        _add_agent_node(graph_builder, node_name, spec, memory)

    graph_builder.add_conditional_edges("route", select_agent_route, route_map)
    graph_builder.add_edge(START, "route")

    graph = graph_builder.compile()
    _log.info(
        "Supervisor graph compiled successfully with %d participant(s)",
        max(len(agent_specs) - 1, 0),
    )
    return graph
