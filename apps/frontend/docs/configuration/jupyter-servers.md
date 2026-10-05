# Jupyter Servers

A Jupyter server provides project file access, notebook kernels, and Campaign
Builder code and JSON-file support.

## Add a server

1. Open **Jupyter Servers**.
2. Select **Create new Jupyter server**.
3. Enter:
   - a recognizable name;
   - the Jupyter server URL; and
   - an authentication token when required.
4. Submit the form.

iHub probes the server status endpoint. A reachable server shows as
**connected**.

## Inspect sessions

Expand a Jupyter server to list its current sessions. Each entry shows:

- session name;
- kernel name and ID;
- time since last activity;
- execution state; and
- number of connections.

Notebook and Campaign Builder can reuse an available session or start a new
kernel.

## Where Jupyter is used

- **Project Files** reads and writes files through the Jupyter contents
  service.
- **Notebook** executes code and stores notebook outputs.
- **Campaign Builder code nodes** execute Python cells.
- **Campaign Builder JSON-file nodes** read `.json` files from the current
  project.

## Troubleshooting

### The server shows failed

Confirm the URL, token, network path, and Jupyter status endpoint. The iHub
server and browser must be able to reach the configured deployment as required
by the integration.

### No kernels are available

An empty session list does not prevent a new notebook from requesting a new
kernel, but the Jupyter deployment must provide an available kernelspec.

### Project Files reports no file server

Confirm that a Jupyter server is configured for the current project and that
the user has an active Jupyter identity and token.

### A JSON-file node cannot read its source

Confirm that the selected file remains in the current project, the configured
Jupyter server is available, and the file contains valid JSON.

## Related guides

- [Notebook](applications/notebook.md)
- [Campaign Builder](applications/campaign-builder.md)
- [Projects and Files](projects-and-files.md)
- [Configuration Overview](configuration/overview.md)
