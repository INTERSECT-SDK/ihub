import type { ContentFile } from '@ihub/utils/types/types'
import {
  formatLocalDateTime,
  parseApiDateTime,
} from '@ihub/utils/helpers/date-time'

import { getProjectFileNameForDisplay } from '../../app/project/project-file-path.ts'

export type ProjectFileSort = 'name' | 'lastModified' | 'type'
export type ProjectFileSortDirection = 'ascending' | 'descending'
export interface ProjectFileSortState {
  sortBy: ProjectFileSort
  direction: ProjectFileSortDirection
}

const fileNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})
export function getProjectFileType(item: ContentFile): string {
  if (item.type === 'directory') {
    return 'Folder'
  }

  const extensionIndex = item.name.lastIndexOf('.')
  return extensionIndex > 0
    ? item.name.slice(extensionIndex + 1).toUpperCase()
    : 'File'
}

function compareNames(left: ContentFile, right: ContentFile): number {
  return fileNameCollator.compare(
    getProjectFileNameForDisplay(left.name),
    getProjectFileNameForDisplay(right.name),
  )
}

/** Resolves a header click into the next sort field and direction. */
export function getNextProjectFileSortState(
  currentState: ProjectFileSortState,
  nextSortBy: ProjectFileSort,
): ProjectFileSortState {
  if (currentState.sortBy === nextSortBy) {
    return {
      sortBy: nextSortBy,
      direction:
        currentState.direction === 'ascending' ? 'descending' : 'ascending',
    }
  }

  return {
    sortBy: nextSortBy,
    direction: nextSortBy === 'lastModified' ? 'descending' : 'ascending',
  }
}

/** Returns a new navigator listing ordered by the selected field. */
export function sortProjectFiles(
  files: ContentFile[],
  sortBy: ProjectFileSort,
  direction: ProjectFileSortDirection,
): ContentFile[] {
  const directionMultiplier = direction === 'ascending' ? 1 : -1

  return [...files].sort((left, right) => {
    let comparison: number

    if (sortBy === 'lastModified') {
      const safeLeftModified =
        parseApiDateTime(left.last_modified)?.getTime() ?? 0
      const safeRightModified =
        parseApiDateTime(right.last_modified)?.getTime() ?? 0
      comparison = safeLeftModified - safeRightModified
    } else if (sortBy === 'type') {
      comparison = fileNameCollator.compare(
        getProjectFileType(left),
        getProjectFileType(right),
      )
    } else {
      comparison = compareNames(left, right)
    }

    return (
      comparison * directionMultiplier ||
      compareNames(left, right) * directionMultiplier
    )
  })
}

/** Removes a file extension from a navigator label without changing its path. */
export function getProjectFileDisplayName(item: ContentFile): string {
  const displayName = getProjectFileNameForDisplay(item.name)

  if (item.type === 'directory') {
    return displayName
  }

  const extensionIndex = displayName.lastIndexOf('.')
  return extensionIndex > 0 ? displayName.slice(0, extensionIndex) : displayName
}

/** Formats a Jupyter timestamp for the compact navigator table. */
export function getProjectFileModifiedLabel(lastModified: string): string {
  return (
    formatLocalDateTime(lastModified, {
      dateStyle: 'short',
      timeStyle: 'short',
    }) ?? 'Unknown'
  )
}
