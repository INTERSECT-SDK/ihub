# Projects and Files

Projects organize documents, collaborators, and project-scoped connections.
The **Projects** page lists the projects you own or can access.

## Create a project

1. Select **New project**.
2. Enter a **Project Name**.
3. Optionally share the new project with an active iHub user.
4. Choose **View** or **Edit** access for that user.
5. Select **Create**.

New projects are private unless they are shared. Sharing changes the project
visibility to shared.

## Open and manage projects

Select a project name to open its launcher. Project owners can use the actions
menu at the end of the project row to:

- **Rename** the project;
- **Share** it, add collaborators, change their View or Edit access, or remove
  their access; and
- **Delete** the project.

Deleting a project cannot be undone.

### View and Edit access

**View** access is intended for opening shared content. **Edit** access is
required for file uploads and editable project work. Only the project owner
can manage collaborators from the Projects page.

## Create a document

Open a project and use **Create a document** in the launcher:

| Launcher item | File type | Opens |
| --- | --- | --- |
| Campaign | `.icmp` | Campaign Builder |
| Notebook | `.ipynb` | Notebook |
| LLM Chat | `.ichat` | Chat |

The new document receives a generated name and opens in a tab. Campaign,
Notebook, and Chat changes are saved automatically after a short delay. Use
the download action inside an application when you also need a local copy.

## Browse project files

Open **Project Files** in the left navigation. Select a row once to highlight
it, or double-click a file to open it in a tab. Double-click a folder to enter
it, and use the breadcrumbs to return to a parent folder.

A solid blue dot beside a campaign file or its open tab means that campaign has
an active run owned by you. The status refreshes automatically while the file
or tab is visible.

File actions appear at the end of each file row:

- **Download file** downloads the original file.
- **Rename file** opens an inline name editor for writable files when you are
  signed in with Edit access.
- **Delete file** asks for inline confirmation before deleting it.

Choose **Rename file**, edit the name before the displayed extension, and
select the checkmark or press Enter to confirm. The extension stays fixed.
Select the cancel action or press Escape to leave the name unchanged. Invalid
names and names already used by another file show an inline error. If the file
is open, its editor and tab follow the new path after a successful rename.

## Upload a file

Signed-in users with Edit access can select **Upload file** in the current
Project Files folder. The server reports the permitted file types and size
limit to the upload control.

The standard supported extensions are:

- `.icmp`, `.ipynb`, `.ichat`, and `.ivis`
- `.json`
- `.txt`

If a file with the same name already exists, iHub asks before overwriting it.
Close an open editor tab for that file before confirming the overwrite.

See [File Formats](help/file-formats.md) for how each format is displayed.

## Related guides

- [Quick Start](quick-start.md)
- [Campaign Builder](applications/campaign-builder.md)
- [Notebook](applications/notebook.md)
- [Chat](applications/chat.md)
