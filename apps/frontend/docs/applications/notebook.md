# Notebook

The Notebook application edits and executes Jupyter `.ipynb` files inside an
iHub project.

## Before you begin

Notebook requires:

- a signed-in user.
- an available [Jupyter server](../configuration/jupyter-servers.md).

## Create or open a notebook

To create a notebook:

1. Open a project.
2. Under **Create a document**, select **Notebook**.

To open an existing notebook, open **Project Files** and double-click its
`.ipynb` file.

## Select a kernel

Use the kernel selector in the notebook toolbar. Each option identifies the
Jupyter server and either:

- starts a new kernel.
- connects the notebook to an existing session.

Select a kernel before running code. If the selector is empty, verify the
Jupyter server connection.

## Work with cells

A notebook supports code and Markdown cells.

- Select **Add Cell** to add a code cell or **Add Markdown** to add a Markdown
  cell at the end of the notebook.
- Select a code cell to edit it.
- Double-click rendered Markdown to edit its source.
- Use the cell controls to insert a code cell above or below, move a cell, or
  delete it.
- Use the Run control or press **Shift+Enter** to execute a code cell.

Shift+Enter advances to the next cell. When the executed code cell is the last
cell, iHub adds a new code cell after it.

Code output can include streams, returned values, and execution errors. The
output and execution count are stored in the notebook document.

## Save and download

Notebook edits and execution results are saved to the project automatically
after a short delay. Select **Download notebook** to export the current
`.ipynb` file.

## Use Jupyter in Campaign Builder

The same Jupyter connection supports Campaign Builder code nodes and project
JSON-file nodes. A code node can start a new kernel or reuse an existing
Jupyter session.

See [Campaign Builder](campaign-builder.md) for node configuration.

## Common problems

### The kernel selector is empty

Open **Jupyter Servers** and verify that a server is configured and reachable.
The server details also list available sessions.

### A cell will not run

Select a kernel, confirm that the code cell is not empty, and check the output
area for a Jupyter execution error.

### The notebook does not open

Confirm that the project file has the `.ipynb` extension and that the Jupyter
file service is available.

## Related guides

- [Projects and Files](projects-and-files.md)
- [Jupyter Servers](configuration/jupyter-servers.md)
- [Campaign Builder](applications/campaign-builder.md)
- [Troubleshooting](help/troubleshooting.md)
