/** Claim-flash parsing + route resolution (§7.3). Pure parsing keeps the LLM
 * boundary testable without a model. */

import { describe, expect, it } from 'vitest'
import { parseClaimFlash, resolveFlashRoute, type FlashRouteAgent } from '../src/claim-flash.ts'

describe('parseClaimFlash', () => {
  it('accepts a valid object', () => {
    expect(parseClaimFlash('{"purpose":"quarterly budget deck","path":"reports/q3.pptx","kind":"ppt"}')).toEqual({
      purpose: 'quarterly budget deck', path: 'reports/q3.pptx', kind: 'ppt',
    })
  })

  it('accepts a null path', () => {
    expect(parseClaimFlash('{"purpose":"a cover image","path":null,"kind":"image"}')).toEqual({
      purpose: 'a cover image', path: null, kind: 'image',
    })
  })

  it('rejects malformed JSON and non-objects', () => {
    expect(parseClaimFlash('not json')).toBeUndefined()
    expect(parseClaimFlash('[]')).toBeUndefined()
    expect(parseClaimFlash('42')).toBeUndefined()
  })

  it('rejects an over-long or empty purpose', () => {
    expect(parseClaimFlash(`{"purpose":"${'x'.repeat(81)}","path":null,"kind":"other"}`)).toBeUndefined()
    expect(parseClaimFlash('{"purpose":"","path":null,"kind":"other"}')).toBeUndefined()
  })

  it('rejects an unknown kind or wrong path type', () => {
    expect(parseClaimFlash('{"purpose":"p","path":null,"kind":"mystery"}')).toBeUndefined()
    expect(parseClaimFlash('{"purpose":"p","path":7,"kind":"code"}')).toBeUndefined()
  })
})

describe('resolveFlashRoute', () => {
  it('uses the session routed provider and the configured flash model', () => {
    const agent: FlashRouteAgent = {
      session: { requestHeader: () => ({ config: { provider: 'deepseek-official' } }) },
      options: { provider: undefined },
    }
    expect(resolveFlashRoute(agent, 'deepseek-v4-flash')).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  })

  it('falls back to the agent option provider', () => {
    const agent: FlashRouteAgent = {
      session: { requestHeader: () => undefined },
      options: { provider: 'deepseek-official' },
    }
    expect(resolveFlashRoute(agent, 'deepseek-v4-flash')).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  })

  it('returns undefined without a provider or model', () => {
    const none: FlashRouteAgent = { session: { requestHeader: () => undefined }, options: { provider: undefined } }
    expect(resolveFlashRoute(none, '')).toBeUndefined()
    expect(resolveFlashRoute(undefined, 'deepseek-v4-flash')).toBeUndefined()
    expect(resolveFlashRoute(none, 'deepseek-v4-flash')).toBeUndefined()
  })
})
