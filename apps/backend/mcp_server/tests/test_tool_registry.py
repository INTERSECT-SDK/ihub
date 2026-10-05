import unittest

from tool_registry import TOOL_REGISTRY, ToolRegistryEntry, register_enabled_tools


class FakeRegistrar:
    def __init__(self) -> None:
        self.registered: list[str] = []

    def tool(self):
        def decorator(func):
            self.registered.append(func.__name__)
            return func

        return decorator


class ToolRegistryTests(unittest.TestCase):
    def test_registry_contains_expected_tools(self) -> None:
        assert set(TOOL_REGISTRY) == {
            'hello_mcp',
            'list_intersect_capabilities',
            'list_intersect_services',
            'random_number',
            'test_visualization',
        }

        for tool_name, entry in TOOL_REGISTRY.items():
            assert isinstance(entry, ToolRegistryEntry)
            assert entry.name == tool_name
            assert entry.func.__name__ == tool_name

    def test_register_enabled_tools_skips_disabled_entries(self) -> None:
        registrar = FakeRegistrar()

        registered, skipped = register_enabled_tools(
            registrar=registrar,
            enabled_tools={
                'hello_mcp': True,
                'list_intersect_capabilities': False,
                'list_intersect_services': True,
                'random_number': True,
            },
            registry={
                'hello_mcp': TOOL_REGISTRY['hello_mcp'],
                'list_intersect_capabilities': TOOL_REGISTRY['list_intersect_capabilities'],
                'list_intersect_services': TOOL_REGISTRY['list_intersect_services'],
                'random_number': TOOL_REGISTRY['random_number'],
            },
        )

        assert registered == ['hello_mcp', 'list_intersect_services', 'random_number']
        assert skipped == ['list_intersect_capabilities']
        assert registrar.registered == ['hello_mcp', 'list_intersect_services', 'random_number']

    def test_register_enabled_tools_defaults_to_enabled(self) -> None:
        registrar = FakeRegistrar()

        registered, skipped = register_enabled_tools(
            registrar=registrar,
            enabled_tools={},
            registry={'hello_mcp': TOOL_REGISTRY['hello_mcp']},
        )

        assert registered == ['hello_mcp']
        assert skipped == []
        assert registrar.registered == ['hello_mcp']
