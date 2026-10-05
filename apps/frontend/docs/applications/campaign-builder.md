# Campaign Builder

Campaign Builder creates an executable workflow from INTERSECT capabilities,
project or inline JSON data, and rendered outputs. Existing saved Code nodes
remain supported, but creating new Code nodes is unavailable. Campaign documents
use the `.icmp` extension.

## Before you begin

At minimum, a runnable campaign needs:

- a signed-in user.
- a connected [INTERSECT server](../configuration/intersect-servers.md).
- at least one live service with an advertised capability.

A [Jupyter server](../configuration/jupyter-servers.md) is also required for
existing saved Code nodes and project JSON-file nodes.

## Create a campaign

1. Open a project.
2. Under **Create a document**, select **Campaign**.
3. In **Set up your campaign**, choose an **INTERSECT instance**.
4. Select **Create first task group**.

The INTERSECT Servers panel calls the saved connection a server or broker. The
Campaign Builder selector calls the same connection an instance.

## Understand the workspace

- The **Campaign** tab is the top-level workflow.
- Each **Task Group** tab contains the tasks and source nodes that run
  together.
- The graph canvas shows nodes and their typed connections.
- The toolbar adds nodes, applies automatic layout, sets campaign iterations,
  runs or stops work, selects the INTERSECT server, and downloads the campaign.
- Status badges show whether a node or task group is waiting, executing,
  complete, in error, or aborted. During task-group loops, node badges include
  their run count and task-group badges show the current iteration. Renderer
  previews identify the iteration that produced their displayed output.

Use **+ Task Group** to divide a larger workflow into logical stages. Open a
task group before adding its tasks or source nodes.

Every node type and task group can be deleted from its node-actions menu.
Select the trash action, then confirm with the checkmark. Deleting a node or
task group also removes its graph connections and dependent campaign
references, including task or group dependencies and objectives that rely on
removed outputs. It does not delete referenced project files or registered
INTERSECT resources.

## Add nodes

Select **Add node** from an open task group.

### Capability nodes

Browse **Services**, choose a capability, and select one of its endpoints.
Capability fields come from the service schema.

For each input, choose:

- **Custom** to enter a value directly or
- **Upstream** to map a compatible value from another node.

At least one capability node is required to run a campaign.

### Code nodes

Code-node creation is unavailable in Campaign Builder. The add menu has no
Code section or kernel picker, even when Jupyter servers are configured.
Existing saved Code nodes can contain executable cells and expose declared
outputs to downstream nodes.

Use the node menu to run, rename, or delete the code node. Code-node work runs
through Jupyter and is not submitted to the INTERSECT orchestrator as a
capability. Standalone notebooks remain available.

### JSON-file nodes

Add **JSON File**, then select a `.json` file from the current project. iHub
builds a field list from the selected file so supported scalar and array values
can be connected to downstream inputs.

If the file changes, the node reports that its field manifest is stale. Select
**Refresh fields** and review the mappings before running the campaign.

### JSON-text nodes

Add **JSON Text**, then enter a valid JSON value directly in the node. iHub
builds a field list from the text so supported scalar and array values can be
connected to downstream inputs. JSON-text nodes do not require a Jupyter
server.

Invalid JSON produces an error, and fields with unsupported runtime types are
marked as unresolved and cannot be mapped.

### Renderer nodes

Under **Renderers**, choose a registered Plotly visualization, **Image**, or
**Text**. Open the renderer's **Configuration** tab to map an upstream value,
then use **Preview** to inspect the result.

- **Image** accepts a byte array, base64 value, or image data URL and supports
  pan and zoom in the preview.
- **Text** displays strings directly and formats structured values as JSON.

Renderer nodes are local presentation nodes and are not submitted to the
INTERSECT orchestrator.

## Connect and configure nodes

Drag from an output handle to a compatible input handle. Incompatible
connections are rejected. When a capability input uses **Upstream**, select the
specific source value when more than one compatible output is available.

Task groups can also define objectives. Available objective types include:

- **Assert** for a Boolean target
- **Iterate** for a repeat count
- **Upper Limit** for a numeric maximum
- **Range** for numeric bounds

Configure objectives only after their referenced task-group outputs are
available.

## Run a campaign

1. Select a connected INTERSECT server.
2. Confirm that the graph contains at least one capability node.
3. Enter a positive **Campaign iterations** value.
4. Select **Run campaign**.

The Run control explains why it is disabled. Common reasons include:

- **Campaign is starting**
- **Campaign is already running**
- **Select an INTERSECT server**
- **The selected INTERSECT server must be connected to run this campaign**
- **Add at least one capability node to run this campaign**

Select **Stop campaign** to stop an active run. Confirm the dialog before the
stop request is sent.

If you switch Hub tabs, refresh the page, or open the campaign in another
browser tab while a run is active, Campaign Builder restores the run's node
statuses, run ID, INTERSECT server, and live updates. Run and the server
selector remain unavailable while iHub checks for and restores an active run.

When more than one active run matches the campaign, choose the run the editor
should follow. The chooser identifies each run by its run ID, INTERSECT server,
and start time.

## Inspect runs

Open **Active Experiments** in the left navigation. The panel refreshes while
it is open and shows each persisted run's:

- campaign name and status
- run ID
- INTERSECT server
- start time
- end time, when available

Search narrows the run list.

## Save and download

Campaign edits are saved to the project automatically after a short delay.
Select **Download** in the toolbar to export the current `.icmp` document.

The `.icmp` extension remains the campaign filename convention, but file content
must use the canonical `CampaignModel` shape with `task_groups`. Retired
`campaignId`/`nodes`/`edges` documents and documents that mix both formats are
rejected with visible validation feedback. Rejection does not dirty, autosave,
delete, or rewrite the original file; it can still be downloaded through
Project Files.

## Campaign architecture and contract maintenance

The Campaign implementation has one canonical editing boundary:

1. The document boundary validates an opened file as a `CampaignModel` before
   mounting the editor.
2. Graph projection presents one canonical task group at a time to the existing
   node components. Domain operations and persistence update only the model.
3. Before execution, the frontend resolves live code and JSON-file values and
   removes editor-only source and renderer tasks from a cloned payload.
4. The backend rejects legacy and hybrid payloads with HTTP 422, then hydrates,
   validates, and orders a canonical model into an orchestrator-ready `Campaign`.
5. The Campaign service records both the submitted document snapshot and the
   compiled orchestrator snapshot before the injected transport starts the run.
   Recovery uses the persisted campaign and run identities; it does not replace
   the saved editor document with the compiled payload.

Backend hydration, compilation, validation, transport, and run persistence are
separate service boundaries under `apps/backend/server/ihub_server/services`.
Legacy-origin historical runs remain available through their immutable stored
snapshots: Campaign Builder displays the executed canonical snapshot read-only
and does not offer restoration into the current editor.

The Pydantic `Campaign` model is authoritative for shared core fields. When it
changes, regenerate and verify the checked-in Python-to-TypeScript contract:

```bash
cd apps/backend/server
pdm run python -m ihub_server.tools.generate_campaign_contract
pdm run python -m ihub_server.tools.generate_campaign_contract --check

cd ../../..
pnpm -C packages/utils generate:campaign-contract
pnpm -C packages/utils check:campaign-contract
pnpm -C packages/utils check-types
pnpm -C packages/ui check-types
pnpm -C packages/ui test:campaign
```

This is a breaking format change with no automatic or offline migration.
Existing database snapshots and rejected project files remain unchanged.

## Common problems

### No services appear

Confirm that an INTERSECT instance is selected, its status is exactly
**connected**, and its services are publishing lifecycle information.

### Run remains disabled

Hover over Run and address the displayed prerequisite. A selected but
disconnected server is not sufficient. If iHub is checking for or restoring an
active run, wait for recovery to finish, choose a run when prompted, or use
**Retry** if recovery fails.

### Campaign recovery failed

Select **Retry** in the recovery alert. Run remains disabled until iHub can
confirm whether this campaign already has an active run, which prevents an
accidental duplicate execution.

### A JSON file cannot be selected

Confirm that the project contains a `.json` file and that a Jupyter file server
is connected. Refresh fields after the source file changes.

### A code node has no kernel

Add or repair the Jupyter connection, then select a running session or start a
new kernel.

## Related guides

- [Quick Start](quick-start.md)
- [INTERSECT Servers](configuration/intersect-servers.md)
- [Jupyter Servers](configuration/jupyter-servers.md)
- [Troubleshooting](help/troubleshooting.md)
