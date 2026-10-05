# Chat

Chat creates persistent `.ichat` conversations with custom iHub agents and
assistants discovered from remote deployments.

## Before you begin

Chat needs at least one available agent:

- A **custom agent** requires a configured LLM. Its selected MCP tools must
  also remain available.
- A **remote assistant** requires a reachable LangGraph, A2A, or AG-UI
  deployment.

See [AI Agents](../configuration/agents.md) to configure either type.

## Create or open a chat

To create a chat:

1. Open a project.
2. Under **Create a document**, select **LLM Chat**.

To open an existing conversation, open **Project Files** and double-click its
`.ichat` file.

## Start a direct chat

1. Use **Choose an agent** to select the lead agent.
2. Select **Start chat**.
3. Enter the opening message.

The connection badge changes from **Connecting** to **Connected** when the chat
room is ready.

## Start a group chat

Group chat is available when the lead custom agent has the **Supervisor -
Multi-agent coordinator** type.

1. Select the supervisor as the lead agent.
2. Under **Additional agents**, select up to eight local or remote
   participants.
3. Select **Start group chat**.

Use an `@` mention to address a participant. Use `@supervisor` to address the
lead agent directly. The Agents badge in the toolbar lists the lead and member
roles in the active room.

## Send messages and files

The composer accepts text, attachments, or both.

- Attach up to five files to one message.
- Attachments can total up to 10 MB per message.
- Empty files are rejected.
- Remove an attachment from the composer before sending if it is no longer
  needed.

iHub passes supported file content to the selected agent and preserves the
attachment metadata in the conversation.

## Follow agent activity

Chat can display:

- agent messages and typing activity.
- tool execution progress and results.
- structured images or other content returned by an agent.
- prompts that require a user response.
- connection or agent errors.

Use **Jump to latest** when new activity arrives below the current scroll
position.

## Save, clear, and download

Chat messages are saved to the `.ichat` project file automatically after a
short delay.

- Select **Erase chat history** to clear the saved conversation.
- Select **Download chat history** to export the current `.ichat` content.

## Common problems

### No agents are available

Open **Agents** and check the status. A custom agent is unavailable when its
LLM is missing or one of its selected MCP tools is unavailable. Remote
assistants depend on their deployment's status.

### Additional agents are unavailable

The lead agent must be a custom Supervisor agent. React agents and remote
assistants can lead direct chats but do not enable the collaborator selector.

### Chat remains on Connecting

Confirm that the selected agent is still available. For a remote assistant,
open **Agents**, check the deployment status, and use **Sync now**.

### An attachment is rejected

Check the five-file, 10 MB total, and non-empty-file limits shown above.

## Related guides

- [AI Agents](configuration/agents.md)
- [LLM Servers](configuration/llm-servers.md)
- [MCP Servers](configuration/mcp-servers.md)
- [Troubleshooting](help/troubleshooting.md)
