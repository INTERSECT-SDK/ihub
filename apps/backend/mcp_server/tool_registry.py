import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol

from tools.basic_tools import hello_mcp, random_number, test_visualization
from tools.intersect_tools import list_intersect_capabilities, list_intersect_services

logger = logging.getLogger(__name__)


ToolCallable = Callable[..., Any]


@dataclass(frozen=True)
class ToolRegistryEntry:
    name: str
    func: ToolCallable


class ToolRegistrar(Protocol):
    def tool(self) -> Callable[[ToolCallable], ToolCallable]: ...


TOOL_REGISTRY: dict[str, ToolRegistryEntry] = {
    'list_intersect_capabilities': ToolRegistryEntry(
        name='list_intersect_capabilities',
        func=list_intersect_capabilities,
    ),
    'list_intersect_services': ToolRegistryEntry(
        name='list_intersect_services',
        func=list_intersect_services,
    ),
    'hello_mcp': ToolRegistryEntry(
        name='hello_mcp',
        func=hello_mcp,
    ),
    'random_number': ToolRegistryEntry(
        name='random_number',
        func=random_number,
    ),
    'test_visualization': ToolRegistryEntry(
        name='test_visualization',
        func=test_visualization,
    ),
}


def register_enabled_tools(
    registrar: ToolRegistrar,
    enabled_tools: Mapping[str, bool],
    registry: Mapping[str, ToolRegistryEntry] | None = None,
) -> tuple[list[str], list[str]]:
    active_registry = registry or TOOL_REGISTRY
    registered_tools: list[str] = []
    skipped_tools: list[str] = []

    for tool_name, entry in active_registry.items():
        if not enabled_tools.get(tool_name, True):
            skipped_tools.append(tool_name)
            continue

        registrar.tool()(entry.func)
        registered_tools.append(tool_name)

    logger.info('Registered MCP tools: %s', ', '.join(registered_tools) or 'none')
    logger.info('Skipped MCP tools: %s', ', '.join(skipped_tools) or 'none')

    return registered_tools, skipped_tools
