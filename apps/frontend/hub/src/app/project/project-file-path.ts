/** Encode a logical path segment-by-segment while preserving directory separators. */
export function encodePathSegments(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/** Reconstruct the decoded logical file path supplied by a Next.js catch-all route. */
export function getLogicalFilePath(filePathSegments: string[]): string {
  return filePathSegments.map(decodePathSegment).join('/')
}

/** Decode one route segment without allowing malformed escapes to break routing. */
export function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

const legacyFriendlyFileNamePattern =
  /^New%20(?:Campaign|Notebook|LLM%20Chat)%20\d+\.(?:icmp|ipynb|ichat)$/i

/**
 * Decodes names produced by the former double-encoded launcher implementation.
 *
 * Arbitrary percent-like filenames remain literal.
 */
export function getProjectFileNameForDisplay(name: string): string {
  return legacyFriendlyFileNamePattern.test(name)
    ? decodePathSegment(name)
    : name
}

/** Build the canonical editor route for a project-relative logical file path. */
export function buildProjectFileRoute(
  projectId: string,
  filePath: string,
): string {
  return `/project/${encodeURIComponent(projectId)}/${encodePathSegments(filePath)}`
}

/** Build a canonical editor route from its full logical path after `/project`. */
export function buildProjectEditorRoute(projectPath: string): string {
  return `/project/${encodePathSegments(projectPath)}`
}

/** Build a Jupyter contents URL for a decoded logical contents path. */
export function buildJupyterContentsUrl(
  jupyterServerBaseUrl: string,
  contentsPath: string,
): string {
  return `${jupyterServerBaseUrl}/api/contents/${encodePathSegments(contentsPath)}`
}
