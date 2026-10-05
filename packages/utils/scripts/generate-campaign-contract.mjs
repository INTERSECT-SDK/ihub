import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import { compile } from 'json-schema-to-typescript'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const schemaPath = resolve(
  repositoryRoot,
  'contracts/campaign/schema/campaign.schema.json',
)
const outputPath = resolve(
  packageRoot,
  'src/types/generated/campaign-contract.ts',
)
const check = process.argv.includes('--check')

const schema = JSON.parse(await readFile(schemaPath, 'utf8'))
const expected = await compile(schema, 'Campaign', {
  bannerComment:
    '/* eslint-disable */\n' +
    '/**\n' +
    ' * This file is generated. Do not edit it directly.\n' +
    ' * Run `pnpm -C packages/utils generate:campaign-contract` instead.\n' +
    ' */',
  cwd: dirname(schemaPath),
  enableConstEnums: false,
  style: {
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 80,
    tabWidth: 2,
  },
  unknownAny: true,
})

let actual
try {
  actual = await readFile(outputPath, 'utf8')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

if (actual === expected) process.exit(0)

if (check) {
  console.error(
    'Campaign TypeScript contract is stale. Regenerate it with:\n' +
      '  pnpm -C packages/utils generate:campaign-contract',
  )
  process.exit(1)
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, expected)
