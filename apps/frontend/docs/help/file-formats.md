# File Formats

iHub associates project files with applications by extension.

## Application documents

| Extension | Application | Behavior |
| --- | --- | --- |
| `.icmp` | Campaign Builder | Editable campaign graph with task groups, nodes, mappings, and execution settings. |
| `.ipynb` | Notebook | Editable Jupyter notebook with code, Markdown, outputs, and execution counts. |
| `.ichat` | Chat | Editable conversation with participants, messages, attachments, and agent activity. |
| `.ivis` | Visualization | Visualization document supported by the project-file viewer. |

The project launcher creates `.icmp`, `.ipynb`, and `.ichat` documents.

## Data and text files

| Extension | Viewer behavior |
| --- | --- |
| `.json` | Read-only formatted JSON when valid; raw text fallback when invalid. |
| `.txt` | Read-only plain text. |

Campaign Builder JSON-file nodes can read `.json` files from the current
project and expose supported fields as node outputs.

## Upload policy

The standard server policy accepts:

```text
.icmp, .ipynb, .ichat, .ivis, .txt, .json
```

The upload control retrieves its permitted extensions and maximum size from
the server. The default maximum is 10 MB, but a deployment can configure a
different limit.

File-extension matching is case-insensitive for the project viewer. Keep the
standard lowercase extensions when creating or sharing files so they work
consistently with other tools.

## Download behavior

- Project Files downloads the original file bytes.
- Campaign, Notebook, and Chat each provide an application toolbar action that
  exports the current document state.

Use the application export after recent edits if you specifically need the
state currently visible in the editor.

## Overwrite behavior

Uploading a file whose name already exists requires confirmation. iHub blocks
the overwrite while an editor tab for that project file is open. Close the tab,
then retry the upload and confirm the replacement.

## Related guides

- [Projects and Files](projects-and-files.md)
- [Campaign Builder](applications/campaign-builder.md)
- [Notebook](applications/notebook.md)
- [Chat](applications/chat.md)
