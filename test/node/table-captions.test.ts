import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, it, expect } from 'vitest'

// Every <table> in the app needs a <caption> so screen readers announce what
// the table holds rather than just "table" (WCAG 1.3.1). Use
// <caption class="is-sr-only"> when a visible heading already names it for
// sighted users. cal-datagrid enforces this for its own table through its
// required `caption` prop; this check covers hand-rolled tables.

const root = join(__dirname, '../..')
const appDir = join(root, 'app')

function vueFiles (): string[] {
  return readdirSync(appDir, { recursive: true, encoding: 'utf8' })
    .filter(f => f.endsWith('.vue'))
    .map(f => join(appDir, f))
}

// Tables whose first child element is not a <caption>, as "file:line".
function uncaptionedTables (file: string): string[] {
  // Blank out comments (keeping newlines) so commented-out markup is ignored
  // and line numbers still line up.
  const source = readFileSync(file, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '))
  const found: string[] = []
  for (const match of source.matchAll(/<table[\s>][^>]*>/g)) {
    const rest = source.slice(match.index + match[0].length)
    if (!/^\s*<caption[\s>]/.test(rest)) {
      const line = source.slice(0, match.index).split('\n').length
      found.push(`${relative(root, file)}:${line}`)
    }
  }
  return found
}

describe('table captions', () => {
  it('finds the app components to check', () => {
    expect(vueFiles().length).toBeGreaterThan(0)
  })

  it('gives every <table> a <caption> as its first child', () => {
    expect(vueFiles().flatMap(uncaptionedTables)).toEqual([])
  })
})
