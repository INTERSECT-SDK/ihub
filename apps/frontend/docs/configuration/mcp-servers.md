# MCP Servers

An MCP server exposes tools that can be assigned to custom iHub agents.

## Add a server

1. Open **MCP Servers**.
2. Select **Create new MCP server**.
3. Enter:
   - a recognizable name
   - the MCP server URL
   - an authentication token when required
4. Submit the form.
5. Expand the server and verify the discovered **Tools** list.

Each tool entry includes its tool name and the description supplied by the MCP
server.

## Assign tools to an agent

1. Open **Agents**.
2. Create or edit a custom agent.
3. In **Tools**, select the MCP tools the agent may use.
4. Save the agent and confirm that it is available.

An agent becomes unavailable if a selected MCP tool is no longer returned by
its server.

## Manage a server

Expand an MCP server to edit or delete it. Leave the token blank during edit to
preserve the stored secret.

Before deleting a server, remove its tools from agents that still need to
remain available.

## Troubleshooting

### No tools are available

Check the URL, token, network path, and the MCP server's own tool
configuration. The server must return a discoverable tool list.

### A custom agent becomes unavailable

Open the agent and compare its selected tools with the tools currently listed
under each MCP server. Remove an obsolete selection or restore the missing
tool.

### A tool call fails in Chat

Confirm that the tool remains discoverable, then check the tool result shown
in Chat. The MCP connection can be healthy even when the individual tool
rejects its inputs.

## Related guides

- [AI Agents](configuration/agents.md)
- [Chat](applications/chat.md)
- [Configuration Overview](configuration/overview.md)
