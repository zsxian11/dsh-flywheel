/** Session-graph fold: working-set cards and file citations from the session log. */

import { describe, expect, it } from 'vitest'
import { factFromEvent, foldFacts, parseCardsFromContent } from '../src/client/graph-fold.ts'
import { fileRolesOf, pathFromToolArgs } from '../src/paths.ts'

describe('pathFromToolArgs', () => {
  it('reads file_path and normalizes slashes', () => {
    expect(pathFromToolArgs({ file_path: 'src\\a.ts' })).toBe('src/a.ts')
  })

  it('ignores http destinations', () => {
    expect(pathFromToolArgs({ path: 'https://example.com/a' })).toBeUndefined()
  })
})

describe('fileRolesOf', () => {
  it('treats edit as both written and opened', () => {
    expect(fileRolesOf('edit')).toEqual(['produced', 'opened'])
  })

  it('omits unknown tools', () => {
    expect(fileRolesOf('bash')).toEqual([])
  })
})

describe('factFromEvent', () => {
  it('reads structured cards on a flywheel-inject notice', () => {
    expect(factFromEvent({
      type: 'user/message',
      data: {
        source: {
          kind: 'plugin',
          plugin: 'flywheel-inject',
          form: 'notice',
          cards: [{ id: 'n1', type: 'artifact', title: 'ACL', path: 'docs/acl.md', summary: 'plan' }],
        },
        content: [],
      },
    })).toEqual({
      kind: 'working-set',
      cards: [{ id: 'n1', type: 'artifact', title: 'ACL', path: 'docs/acl.md', summary: 'plan' }],
    })
  })

  it('parses card lines when the source has no cards array', () => {
    const cards = parseCardsFromContent([
      { type: 'text', text: '- [artifact] ACL (docs/acl.md) — plan\n- [claim] 用途' },
    ])
    expect(cards).toEqual([
      { id: 'docs/acl.md', type: 'artifact', title: 'ACL', path: 'docs/acl.md', summary: 'plan' },
      { id: '用途', type: 'claim', title: '用途', summary: '' },
    ])
  })

  it('reads cards from a V3 snapshot section when content has no list lines', () => {
    expect(factFromEvent({
      type: 'user/message',
      data: {
        source: {
          kind: 'plugin',
          plugin: 'flywheel-inject',
          form: 'snapshot',
          sections: [{
            name: 'flywheel-inject',
            text: '- [artifact] ACL (docs/acl.md) — plan',
          }],
        },
        content: [{ type: 'text', text: '## 会话飞轮工作集' }],
      },
    })).toEqual({
      kind: 'working-set',
      cards: [{ id: 'docs/acl.md', type: 'artifact', title: 'ACL', path: 'docs/acl.md', summary: 'plan' }],
    })
  })

  it('ignores a real user message', () => {
    expect(factFromEvent({
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] },
    })).toBeNull()
  })

  it('records a read path as opened', () => {
    expect(factFromEvent({
      type: 'tool/call',
      data: { name: 'read', callId: 'c1', arguments: { file_path: 'src/a.ts' } },
    })).toEqual({
      kind: 'file', path: 'src/a.ts', tool: 'read', roles: ['opened'],
    })
  })
})

describe('foldFacts', () => {
  it('keeps the latest working set and unique file paths', () => {
    const snapshot = foldFacts([
      { kind: 'working-set', cards: [{ id: 'old', type: 'artifact', title: 'old', summary: '' }] },
      { kind: 'file', path: 'a.ts', tool: 'read', roles: ['opened'] },
      { kind: 'file', path: 'a.ts', tool: 'read', roles: ['opened'] },
      { kind: 'file', path: 'b.ts', tool: 'write', roles: ['produced'] },
      { kind: 'working-set', cards: [{ id: 'new', type: 'artifact', title: 'new', summary: '' }] },
    ])
    expect(snapshot.workingSet).toEqual([{ id: 'new', type: 'artifact', title: 'new', summary: '' }])
    expect(snapshot.opened.map(file => file.path)).toEqual(['a.ts'])
    expect(snapshot.produced.map(file => file.path)).toEqual(['b.ts'])
  })
})
