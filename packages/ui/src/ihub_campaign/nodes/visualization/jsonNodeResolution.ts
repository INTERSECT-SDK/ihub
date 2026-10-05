import type { CampaignNode } from '@ihub/utils/types/campaign'
import type { JsonFileNodeValueResolver } from '../../execution/materialization'

type JsonNodeValueResolvers = {
  resolveJsonFileNodeValue: JsonFileNodeValueResolver
  resolveJsonTextNodeValue: JsonFileNodeValueResolver
}

/** Resolves a selected JSON node pointer with the resolver for its node type. */
export async function resolveJsonNodeMappingValue(
  sourceNode: CampaignNode,
  sourcePath: string,
  resolvers: JsonNodeValueResolvers,
): Promise<unknown> {
  const resolved =
    sourceNode.type === 'json-file'
      ? await resolvers.resolveJsonFileNodeValue(sourceNode, sourcePath)
      : await resolvers.resolveJsonTextNodeValue(sourceNode, sourcePath)

  return resolved.value
}
