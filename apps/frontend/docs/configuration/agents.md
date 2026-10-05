# AI Agents

The **Agents** panel supports two agent sources:

- **Custom agents** built and run by iHub.
- **Remote assistants** discovered from LangGraph, A2A, or AG-UI
  deployments.

Both sources appear in the Chat agent selector when they are available.

## Choose an agent type

| Need | Recommended source |
| --- | --- |
| An iHub-managed prompt, model, and tool set | Custom React agent |
| A lead agent that coordinates a group chat | Custom Supervisor agent |
| An assistant already deployed elsewhere | Remote deployment |

## Create a custom agent

### Prerequisites

Create an [LLM Server](configuration/llm-servers.md) first. If the agent needs
tools, also create an [MCP Server](configuration/mcp-servers.md) and confirm
that its tools appear.

### Steps

1. Open **Agents**.
2. Select **Add agents** and then **Create custom agent**.
3. Complete the configuration:

| Field | Required | Description |
| --- | --- | --- |
| Name | Yes | Agent name shown in Chat. |
| Description | No | Human-readable purpose. |
| System Prompt | No | Instructions applied to the agent. |
| Agent Type | Yes | React tool-calling agent or Supervisor coordinator. |
| Language Model | Yes | One configured LLM server. |
| Tools | No | MCP tools exposed to this agent. |
| Visibility | Yes | Private, shared, or public. |

4. Submit the form.
5. Expand the agent and confirm that its status is available.

A custom agent becomes unavailable when its LLM record is missing or a
selected MCP tool can no longer be found.

### React and Supervisor agents

- **React - Tool-calling agent** handles a direct conversation and can invoke
  its selected tools.
- **Supervisor - Multi-agent coordinator** can lead a Chat room with up to
  eight additional local or remote agents.

The Agents panel can clone, edit, or delete a custom agent. A clone receives a
new name and version while retaining the source configuration.

## Connect a remote deployment

1. Open **Agents**.
2. Select **Add agents** and then **Add server connection**.
3. Choose **LangGraph**, **A2A**, or **AG-UI**.
4. Enter a name, server URL, and optional authentication token.
5. Select **Connect remote deployment**.

iHub synchronizes remote assistants when the Agents panel loads, after a new
deployment is added, and periodically while the panel remains mounted. Use
**Sync now** from the deployment action menu when you need an immediate
refresh.

The deployment section shows its protocol, URL, and current status. Assistants
discovered from the deployment appear in the main Agents list.

### Protocol notes

- **LangGraph** connects to a compatible remote graph deployment.
- **A2A** discovers assistant metadata through an Agent Card and supported
  interfaces.
- **AG-UI** connects to a compatible request and event-stream endpoint.

Use the URL and authentication format provided by the deployment owner.

## Use an agent in Chat

1. Create or open an `.ichat` document.
2. Select an available custom agent or remote assistant as the lead.
3. For a group chat, select a custom Supervisor and then choose additional
   agents.
4. Start the room and send a message.

See [Chat](applications/chat.md) for mentions, files, prompts, and tool
activity.

## Troubleshooting

### A custom agent is unavailable

Confirm that its selected LLM still exists. If the agent uses MCP tools, open
each MCP server and confirm that every selected tool is still discovered.

### No remote assistants appear

Check the deployment URL, protocol, token, and status, then select **Sync now**.
The remote service must expose assistants in the form expected by its selected
protocol.

### Group chat options do not appear

Select a custom Supervisor agent as the lead. React agents and remote
assistants do not enable the additional-agent selector.

### A deleted connection breaks an existing chat

Recreate or repair the dependency, then reopen the Chat document and select an
available lead agent.

## Related guides

- [Chat](applications/chat.md)
- [LLM Servers](configuration/llm-servers.md)
- [MCP Servers](configuration/mcp-servers.md)
- [Configuration Overview](configuration/overview.md)
