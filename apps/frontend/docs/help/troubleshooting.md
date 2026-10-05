# Troubleshooting

Start with the symptom below, then follow the linked guide for detailed
configuration.

## Projects and files

### No projects appear

Confirm that you are signed in with the intended account. The Projects page
shows projects you own, projects explicitly shared with you, and public
projects.

### Project Files says no file server is connected

Add or repair the current project's
[Jupyter server](configuration/jupyter-servers.md). Project Files uses the
Jupyter contents service.

### Upload file is disabled

The tooltip reports the current reason. Common causes are:

- View access instead of Edit access;
- an unavailable project record;
- an unavailable upload policy; or
- a missing Jupyter user.

### An upload is rejected

Check the extension and the size limit reported by the upload control. If the
file already exists, close any open editor tab for that file before confirming
the overwrite.

### A document change does not persist

Campaign, Notebook, and Chat changes are saved after a short delay. Confirm
that you have edit access, keep the tab open long enough for the save, and
check whether the application displays a load or connection error.

## Campaign Builder

### No INTERSECT instances are available

Open [INTERSECT Servers](configuration/intersect-servers.md), create the
connection if necessary, and make sure it reaches **connected**.

### No services appear in Add node

Select an INTERSECT instance and confirm that its expanded server entry shows
discovered services and capabilities. The service must publish lifecycle
information to that broker.

### Run is disabled

Hover over Run. The tooltip identifies the first unmet condition:

- A start or run is already in progress.
- iHub is checking for or restoring an active run.
- An active run must be selected or recovery must be retried.
- No INTERSECT server is selected.
- The selected server is not connected.
- The campaign has no capability node.

If **Campaign recovery failed** appears, select **Retry**. Run remains disabled
until iHub can confirm whether the campaign already has an active run. If more
than one active run matches the campaign, choose the run the editor should
follow from the recovery dialog.

### A connection between nodes is rejected

Use output and input handles with compatible types. For capability inputs,
select **Upstream** and choose a compatible source value, or switch to
**Custom** and enter the value directly.

### A JSON-file node is stale

The source file changed after its field manifest was created. Select
**Refresh fields**, review all mappings, and then run the campaign.

## Notebook

### The kernel selector is empty

Check [Jupyter Servers](configuration/jupyter-servers.md). Confirm the
server status and that the deployment provides a usable kernelspec.

### A code cell will not run

Select a kernel and ensure the cell contains code. Execution failures are
rendered in the cell output.

## Chat and agents

### No agents appear in Chat

Open [AI Agents](configuration/agents.md):

- For a custom agent, confirm that its LLM and all selected MCP tools still
  exist.
- For a remote assistant, confirm the deployment status and select **Sync
  now**.

### The custom agent is unavailable

Repair its [LLM server](configuration/llm-servers.md). If it uses tools, also
check each [MCP server](configuration/mcp-servers.md).

### Group chat is unavailable

The lead must be a custom **Supervisor - Multi-agent coordinator** agent.
Select that lead before choosing additional participants.

### Chat remains on Connecting

Confirm that the lead agent is available. For a remote assistant, check its
deployment URL, protocol, token, and sync status.

### A file cannot be attached

A message accepts up to five non-empty files totaling no more than 10 MB.

## Connection and credential issues

### An edited connection loses access

Secret fields are blank when an existing connection is opened for editing.
Leave a secret blank to preserve it. Enter a value only when replacing the
stored secret.

### A saved server does not prove the service is healthy

Connection panels use different health signals. In particular, a listed LLM
configuration is not a model test. Verify the service URL and credentials with
the service owner when dependent operations fail.
