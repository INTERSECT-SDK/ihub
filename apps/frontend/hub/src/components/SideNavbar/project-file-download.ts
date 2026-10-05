export interface RowActionEvent {
  stopPropagation: () => void
}

export interface ProjectFileDownloadDocument {
  createElement: (tagName: 'a') => HTMLAnchorElement
  body: Pick<HTMLBodyElement, 'append'>
}

/**
 * Builds the API download URL for a project file and appends required Jupyter
 * context query parameters.
 */
export function buildProjectFileDownloadUrl(
  path: string,
  jupyterUser: string,
  jupyterServerUrl: string,
): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  const params = new URLSearchParams({
    jupyter_user: jupyterUser,
    jupyter_server_url: jupyterServerUrl,
  })

  return `/api/v1/contents/download/${encodedPath}?${params.toString()}`
}

/**
 * Starts a browser-managed download without buffering its response in
 * JavaScript. The authenticated same-origin request is made by the browser.
 */
export function launchProjectFileDownload(
  url: string,
  filename: string,
  downloadDocument: ProjectFileDownloadDocument = document,
): void {
  const anchor = downloadDocument.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  downloadDocument.body.append(anchor)
  anchor.click()
  anchor.remove()
}

/**
 * Stops row action event bubbling so parent row click handlers are not
 * triggered.
 */
export function stopProjectFileRowActionEvent(event: RowActionEvent): void {
  event.stopPropagation()
}
