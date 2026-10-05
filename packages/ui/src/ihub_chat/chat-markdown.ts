type ParsedAsciiTable = {
  markdown: string[]
  nextLineIndex: number
}

function splitCells(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean)
}

function parseAsciiTable(
  lines: string[],
  startLineIndex: number,
): ParsedAsciiTable | null {
  const headerMatch = lines[startLineIndex]?.match(/^\s*\|\s*(.+?)\s*$/)
  const separator = lines[startLineIndex + 1]
  if (!headerMatch?.[1] || !separator || !/^\s*-{3,}\s*$/.test(separator)) {
    return null
  }

  const headerCells = splitCells(headerMatch[1])
  if (headerCells.length < 2) {
    return null
  }

  const rows: string[][] = []
  let lineIndex = startLineIndex + 2
  while (lineIndex < lines.length) {
    const rowMatch = lines[lineIndex]?.match(/^\s*(\S+)\s*\|\s*(.+?)\s*$/)
    if (!rowMatch?.[1] || !rowMatch[2]) {
      break
    }

    const valueCells = splitCells(rowMatch[2])
    if (valueCells.length !== headerCells.length) {
      return null
    }

    rows.push([rowMatch[1], ...valueCells])
    lineIndex += 1
  }

  if (rows.length === 0) {
    return null
  }

  const headings = ['', ...headerCells]
  return {
    markdown: [
      `| ${headings.join(' | ')} |`,
      `| ${headings.map(() => '---').join(' | ')} |`,
      ...rows.map((row) => `| ${row.join(' | ')} |`),
    ],
    nextLineIndex: lineIndex,
  }
}

function parseFencedAsciiTable(
  lines: string[],
  startLineIndex: number,
  fenceMarker: '```' | '~~~',
): ParsedAsciiTable | null {
  if (lines[startLineIndex]?.trim() !== fenceMarker) {
    return null
  }

  const closingLineIndex = lines.findIndex(
    (line, index) =>
      index > startLineIndex && line.trim().startsWith(fenceMarker),
  )
  if (closingLineIndex === -1) {
    return null
  }

  const contentLines = lines.slice(startLineIndex + 1, closingLineIndex)
  while (contentLines.length > 0 && !contentLines[0]?.trim()) {
    contentLines.shift()
  }
  while (contentLines.length > 0 && !contentLines.at(-1)?.trim()) {
    contentLines.pop()
  }

  const table = parseAsciiTable(contentLines, 0)
  if (!table || table.nextLineIndex !== contentLines.length) {
    return null
  }

  return {
    markdown: table.markdown,
    nextLineIndex: closingLineIndex + 1,
  }
}

/**
 * Converts common whitespace-delimited ASCII matrices into GFM tables.
 *
 * The narrow pattern avoids rewriting prose, existing Markdown tables, and
 * intentionally preformatted content inside fenced code blocks.
 */
export function normalizeAsciiTables(markdown: string): string {
  const lines = markdown.split('\n')
  const normalizedLines: string[] = []
  let fenceMarker: '```' | '~~~' | null = null
  let lineIndex = 0

  while (lineIndex < lines.length) {
    const line = lines[lineIndex] || ''
    const trimmedLine = line.trimStart()
    const nextFenceMarker = trimmedLine.startsWith('```')
      ? '```'
      : trimmedLine.startsWith('~~~')
        ? '~~~'
        : null

    if (fenceMarker && trimmedLine.startsWith(fenceMarker)) {
      fenceMarker = null
      normalizedLines.push(line)
      lineIndex += 1
      continue
    }

    if (!fenceMarker && nextFenceMarker) {
      const fencedTable = parseFencedAsciiTable(
        lines,
        lineIndex,
        nextFenceMarker,
      )
      if (fencedTable) {
        if (normalizedLines.at(-1)?.trim()) {
          normalizedLines.push('')
        }
        normalizedLines.push(...fencedTable.markdown)
        if (lines[fencedTable.nextLineIndex]?.trim()) {
          normalizedLines.push('')
        }
        lineIndex = fencedTable.nextLineIndex
        continue
      }

      fenceMarker = nextFenceMarker
      normalizedLines.push(line)
      lineIndex += 1
      continue
    }

    if (!fenceMarker) {
      const table = parseAsciiTable(lines, lineIndex)
      if (table) {
        if (normalizedLines.at(-1)?.trim()) {
          normalizedLines.push('')
        }
        normalizedLines.push(...table.markdown)
        if (lines[table.nextLineIndex]?.trim()) {
          normalizedLines.push('')
        }
        lineIndex = table.nextLineIndex
        continue
      }
    }

    normalizedLines.push(line)
    lineIndex += 1
  }

  return normalizedLines.join('\n')
}
