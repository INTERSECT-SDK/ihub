# Glossary

## Agent

An AI participant available to Chat. iHub supports custom agents and
assistants discovered from remote deployments.

## A2A

An agent-to-agent protocol supported when connecting a remote agent
deployment.

## AG-UI

A protocol for connecting a remote agent endpoint that exchanges requests and
streamed agent events.

## Campaign

An `.icmp` document that organizes executable capability tasks, local code,
data sources, mappings, objectives, and visualizations.

## Capability

An operation advertised by an INTERSECT service. A capability can expose one
or more endpoints with typed inputs and outputs.

## Custom agent

An agent configured in iHub with a system prompt, graph type, LLM, optional MCP
tools, and visibility.

## Document

An application file stored in a project. The primary document types are
Campaign, Notebook, and Chat.

## Endpoint

A callable operation within an INTERSECT capability. Selecting an endpoint
creates the corresponding capability node in Campaign Builder.

## INTERSECT instance

The Campaign Builder term for a saved INTERSECT server connection.

## INTERSECT server

A broker connection stored in iHub. It supplies discovered services and
capabilities and, when configured, the orchestrator used for campaign
execution.

## Jupyter kernel

The computational process that executes notebook or code-node cells.

## Jupyter server

The configured service that supplies project file access, kernels, and
sessions.

## LLM server

A configured Ollama or Azure language-model endpoint used by custom agents.

## MCP server

A Model Context Protocol service that exposes tools which can be assigned to a
custom agent.

## Project

A workspace with an owner, collaborators, project files, and project-scoped
resources.

## React agent

The iHub label for a tool-calling custom agent used for direct Chat
conversations. This agent type is distinct from the React user-interface
library.

## Remote assistant

An assistant discovered by synchronizing a LangGraph, A2A, or AG-UI remote
deployment.

## Service

An INTERSECT participant that advertises one or more capabilities and
publishes lifecycle information.

## Supervisor agent

A custom agent that can coordinate a group Chat with additional local or
remote agents.

## Task group

A Campaign Builder section that organizes tasks which run together and can
define objectives over their outputs.

## Tool

An operation discovered from an MCP server and made available to a custom
agent.
