# iHub

iHub is a workspace for building and running research workflows across the
[INTERSECT](https://intersect-python-sdk.readthedocs.io/en/latest/) ecosystem.
It brings INTERSECT capabilities, computational notebooks, and AI agents into
project-based applications.

## What you can do

- Build campaigns that connect INTERSECT capabilities, Python code, project
  data, and visualizations.
- Create and run Jupyter notebooks without leaving the iHub workspace.
- Chat with custom or remote AI agents, including supervisor-led groups.
- Organize documents and shared resources in projects.
- Configure the INTERSECT, Jupyter, language-model, MCP, and agent connections
  used by those applications.

## How iHub is organized

| Concept | Purpose |
| --- | --- |
| Project | A workspace with an owner, collaborators, and project files. |
| Document | A Campaign, Notebook, or Chat file created from the project launcher. |
| Connection | A configured INTERSECT, Jupyter, LLM, MCP, or remote-agent server. |
| Capability | An operation advertised by an INTERSECT service and available to a campaign. |
| Agent | A custom iHub agent or an assistant discovered from a remote deployment. |

After you open a project, the left navigation gives you access to project
files, campaign runs, server connections, and agents. The project launcher in
the main view creates new documents.

The first time a signed-in user opens a project launcher, iHub starts a guided
tour of the launcher and left navigation. Open **Account** and select **Take a
tour** to replay the guide later.

## Access levels

- **Project collaborators with View access** can open shared project content
  but cannot upload files.
- **Project collaborators with Edit access** can work with editable project
  content and upload supported files.
- **Project owners** can rename or delete their projects and manage
  collaborator access.
- **Configurators** are signed-in users trusted with the server addresses and
  credentials required to add iHub connections.

## Start here

Follow the [Quick Start](quick-start.md) to create a project and run a small
campaign. For a broader orientation, see [Projects and Files](projects-and-files.md)
or open one of the application guides:

- [Campaign Builder](applications/campaign-builder.md)
- [Notebook](applications/notebook.md)
- [Chat](applications/chat.md)

If your application is missing a required service, begin with the
[Configuration Overview](configuration/overview.md).
