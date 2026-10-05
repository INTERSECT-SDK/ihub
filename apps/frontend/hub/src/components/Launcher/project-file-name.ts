import { getProjectFileNameForDisplay } from '../../app/project/project-file-path.ts'

/** Validates and extracts names from a Jupyter directory listing. */
export function getProjectListingNames(value: unknown): string[] {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('content' in value) ||
    !Array.isArray(value.content) ||
    !value.content.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        'name' in item &&
        typeof item.name === 'string',
    )
  ) {
    throw new Error('Project file listing is malformed.')
  }

  return (value.content as Array<{ name: string }>).map(({ name }) => name)
}

/** Chooses the next friendly numbered filename for a launcher document. */
export function getNextProjectFileName(
  existingNames: string[],
  documentLabel: string,
  extension: string,
): string {
  const baseName = `New ${documentLabel}`
  const escapedBaseName = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedExtension = extension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const numberedNamePattern = new RegExp(
    `^${escapedBaseName} (\\d+)\\.${escapedExtension}$`,
    'i',
  )
  const highestNumber = existingNames.reduce((highest, name) => {
    const match = getProjectFileNameForDisplay(name).match(numberedNamePattern)
    const number = match?.[1] ? Number.parseInt(match[1], 10) : 0
    return Math.max(highest, number)
  }, 0)

  return `${baseName} ${highestNumber + 1}.${extension}`
}
