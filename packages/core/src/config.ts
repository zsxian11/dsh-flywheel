/** Canonical flywheel config schema + defaults + per-field validation. This is the single
 * source shared by the settings card (schemastery mirror), CLI config.json, and Cursor. */

import type { FlywheelConfig } from './model.ts'

/** Defaults applied when a field is absent (the schema `default` layer in the DSH bundle). */
export const DEFAULT_CONFIG: FlywheelConfig = {
  enabled: true,
  inject: true,
  tools: true,
  dbRelativePath: '.dsh/flywheel/index.sqlite',
  ftsK: 8,
  hop: 1,
  hopExtra: 5,
  maxChars: 3000,
  lexicalBackend: 'sqlite-fts',
  elasticsearch: {
    node: 'http://127.0.0.1:9200',
    indexPrefix: 'dsh-flywheel',
    apiKey: '',
  },
  vectorBackend: 'off',
  vector: {
    provider: '',
    model: '',
    vectorK: 8,
    embedQuery: false,
  },
  claimFlash: true,
  summarizationModel: 'deepseek-v4-flash',
  extractors: ['generic'],
  mediaCaption: false,
  windowCompact: true,
  windowPendingPattern: '另外|换个|新需求|先不管刚才|开始实现|开始写代码',
  supersedePattern: '不对|不是|改成|作废|作废上次|取消刚才|不要按上次|口径改了|需求变了',
}

/** Stable, machine-readable validation error codes surfaced to the settings card. */
export type FlywheelConfigErrorCode =
  | 'positiveInt'
  | 'hopOnlyOne'
  | 'maxCharsRange'
  | 'lexicalBackendNotMounted'
  | 'esNodeAbsoluteUrl'
  | 'esNodeReachable'
  | 'esApiKeyResolvable'
  | 'vectorProviderRequired'
  | 'vectorBackendNotMounted'
  | 'unknownExtractor'
  | 'unknownKey'
  | 'emptyPattern'

export interface FlywheelConfigError {
  field: string
  code: FlywheelConfigErrorCode
  message: string
}

/**
 * Deep-validate a candidate config object. Returns errors only; callers decide
 * whether to throw (load) or refuse a settings write. Validating here rather
 * than at use keeps fail-loud semantics at the write boundary.
 */
export function validateFlywheelConfig(candidate: Record<string, unknown>): FlywheelConfigError[] {
  const errors: FlywheelConfigError[] = []
  const intField = (key: string, min: number, max = Number.MAX_SAFE_INTEGER): void => {
    const value = candidate[key]
    if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)) {
      errors.push({ field: key, code: 'positiveInt', message: `${key} must be a positive integer in [${min}, ${max}]` })
    }
  }
  intField('ftsK', 1)
  intField('hopExtra', 0)
  intField('maxChars', 500, 8000)
  if (candidate.hop !== undefined && candidate.hop !== 1) {
    errors.push({ field: 'hop', code: 'hopOnlyOne', message: 'v1 schema locks hop to 1' })
  }
  const lexical = candidate.lexicalBackend
  if (lexical !== undefined && typeof lexical === 'string' && lexical.length === 0) {
    errors.push({ field: 'lexicalBackend', code: 'lexicalBackendNotMounted', message: 'lexicalBackend must be a mounted backend id' })
  }
  if (candidate.supersedePattern !== undefined && String(candidate.supersedePattern).trim() === '') {
    errors.push({ field: 'supersedePattern', code: 'emptyPattern', message: 'supersedePattern must not be empty' })
  }
  if (candidate.windowPendingPattern !== undefined && String(candidate.windowPendingPattern).trim() === '') {
    errors.push({ field: 'windowPendingPattern', code: 'emptyPattern', message: 'windowPendingPattern must not be empty' })
  }
  return errors
}
