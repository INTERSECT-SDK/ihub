import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizeAsciiTables } from './chat-markdown'

test('normalizeAsciiTables converts a numeric ASCII matrix to GFM', () => {
  const input = `  | 0.00  1.00  2.00
-------------------------
0.00 | 0.12  0.15  0.18
1.00 | 0.10  0.13  0.16`

  assert.equal(
    normalizeAsciiTables(input),
    `|  | 0.00 | 1.00 | 2.00 |
| --- | --- | --- | --- |
| 0.00 | 0.12 | 0.15 | 0.18 |
| 1.00 | 0.10 | 0.13 | 0.16 |`,
  )
})

test('normalizeAsciiTables converts a fenced ASCII-only matrix', () => {
  const input = `\`\`\`
  | 0.00  1.00
----------------
0.00 | 0.12  0.15
\`\`\``

  assert.equal(
    normalizeAsciiTables(input),
    `|  | 0.00 | 1.00 |
| --- | --- | --- |
| 0.00 | 0.12 | 0.15 |`,
  )
})

test('normalizeAsciiTables leaves ordinary fenced code unchanged', () => {
  const input = `\`\`\`python
print('hello')
\`\`\``

  assert.equal(normalizeAsciiTables(input), input)
})

test('normalizeAsciiTables leaves malformed matrices unchanged', () => {
  const input = `  | 0.00  1.00
----------------
0.00 | 0.12`

  assert.equal(normalizeAsciiTables(input), input)
})
