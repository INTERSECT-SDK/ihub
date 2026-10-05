# Configuration Overview

iHub applications depend on connections configured from the left navigation.

## Dependency map

| Application or feature | Required connection | Optional connection |
| --- | --- | --- |
| Campaign capability nodes | Connected INTERSECT server | Jupyter for code and JSON-file nodes |
| Notebook | Jupyter server | None |
| Custom AI agent | LLM server | MCP server tools |
| Remote AI assistant | LangGraph, A2A, or AG-UI deployment | Deployment-specific authentication |
| Chat | Available custom agent or remote assistant | Additional agents for supervisor group chat |
| Project Files | Jupyter file service | None |

Configure dependencies before creating the document that uses them. This keeps
the application workflow focused and makes missing-connection errors easier to
diagnose.

## Configuration order

For Campaign Builder:

1. Add and connect an [INTERSECT Server](intersect-servers.md).
2. Add a [Jupyter Server](jupyter-servers.md) if the campaign uses code or
   project JSON.
3. Confirm that the required services and capabilities appear.

For Chat with a custom agent:

1. Add an [LLM Server](llm-servers.md).
2. Optionally add an [MCP Server](mcp-servers.md) and verify its tools.
3. Create an [AI Agent](agents.md) with that model and tool selection.

For Chat with a remote assistant:

1. Add the remote deployment from [AI Agents](agents.md).
2. Sync the deployment.
3. Confirm that its assistants appear and are available.

## Project scope

When a project is selected, iHub requests project-scoped lists for several
connections and agents. Create and verify connections from the project where
they will be used.

## Credentials and tokens

- Obtain connection details from the service owner.
- Use TLS-enabled URLs and protocols when the deployment supports them.
- Do not put passwords, API keys, or tokens into project documents, chat
  messages, screenshots, or documentation examples.
- Password fields are intentionally blank when editing an existing
  connection. Leave them blank to preserve the stored secret, or enter a new
  value to replace it.
- Remove unused connections and rotate credentials according to the owning
  service's policy.

## Status is dependency-specific

Different panels determine availability in different ways:

- INTERSECT Servers use explicit connect and disconnect actions.
- Jupyter Servers probe server status and list sessions.
- MCP Servers discover tools; an empty tool list can make a selected agent
  unavailable.
- Custom agents are available only while their configured LLM record and
  selected MCP tools are present.
- Remote assistants inherit the status of their remote deployment.

Use the application-specific troubleshooting sections when a saved
configuration exists but its dependent feature is still unavailable.
