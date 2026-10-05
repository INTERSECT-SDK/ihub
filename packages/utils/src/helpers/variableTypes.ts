const NUMERIC_SCHEMA_TYPES = new Set(['integer', 'number'])
const PYTHON_PRIMITIVE_TYPE_ALIASES: Record<string, string> = Object.freeze({
  bool: 'boolean',
  dict: 'object',
  float: 'number',
  int: 'integer',
  nonetype: 'null',
  str: 'string',
})

export function normalizeVariableType(type: unknown): string {
  return typeof type === 'string'
    ? type.trim().toLowerCase().replace(/\s+/g, '')
    : ''
}

function getNormalizedVariableTypeOptions(type: unknown): string[] {
  return normalizeVariableType(type)
    .split('|')
    .map((typeOption) => normalizeVariableTypeOption(typeOption.trim()))
    .filter(Boolean)
}

function normalizeVariableTypeOption(normalizedTypeOption: string): string {
  if (normalizedTypeOption.endsWith('[]')) {
    const normalizedItemType = normalizedTypeOption.slice(0, -2)
    return `${PYTHON_PRIMITIVE_TYPE_ALIASES[normalizedItemType] ?? normalizedItemType}[]`
  }
  return (
    PYTHON_PRIMITIVE_TYPE_ALIASES[normalizedTypeOption] ?? normalizedTypeOption
  )
}

function getArrayItemType(normalizedType: string): string | null {
  return normalizedType.endsWith('[]') ? normalizedType.slice(0, -2) : null
}

function singleVariableTypesAreCompatible(
  normalizedSource: string,
  normalizedTarget: string,
): boolean {
  if (normalizedSource === normalizedTarget) return true
  const sourceItemType = getArrayItemType(normalizedSource)
  const targetItemType = getArrayItemType(normalizedTarget)
  if (sourceItemType || targetItemType) {
    return Boolean(
      sourceItemType &&
      targetItemType &&
      NUMERIC_SCHEMA_TYPES.has(sourceItemType) &&
      NUMERIC_SCHEMA_TYPES.has(targetItemType),
    )
  }
  return (
    NUMERIC_SCHEMA_TYPES.has(normalizedSource) &&
    NUMERIC_SCHEMA_TYPES.has(normalizedTarget)
  )
}

/** Compares schema and runtime type labels used by campaign mappings. */
export function variableTypesAreCompatible(
  sourceType: unknown,
  targetType: unknown,
): boolean {
  const normalizedSourceTypes = getNormalizedVariableTypeOptions(sourceType)
  const normalizedTargetTypes = getNormalizedVariableTypeOptions(targetType)
  if (
    normalizedSourceTypes.length === 0 ||
    normalizedTargetTypes.length === 0
  ) {
    return false
  }
  return normalizedSourceTypes.every((normalizedSource) =>
    normalizedTargetTypes.some((normalizedTarget) =>
      singleVariableTypesAreCompatible(normalizedSource, normalizedTarget),
    ),
  )
}
