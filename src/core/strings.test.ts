import { describe, it, expect } from 'vitest'
import { escapeHtml } from './strings'

describe('escapeHtml', () => {
  it('escapes markup and both quotes', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
  })

  it('leaves plain text alone', () => {
    expect(escapeHtml('Millbrae BART')).toBe('Millbrae BART')
  })
})
