/** Schemastery config schema for the `flywheel` settings namespace. Field names
 * and defaults mirror `@dsh-flywheel/core` DEFAULT_CONFIG and the CLI JSON schema.
 * The interface stays all-optional (repo convention: a consumer's `apply` fills
 * constants); `resolveConfig` produces the fully-defaulted core type. */

import z from '@deepseek-ai/schemastery'
import { DEFAULT_CONFIG, type FlywheelConfig } from '@dsh-flywheel/core'

/** Settings section (all fields optional; defaults live in the schema). */
export interface Config {
  enabled?: boolean
  inject?: boolean
  tools?: boolean
  dbRelativePath?: string
  ftsK?: number
  hop?: 1
  hopExtra?: number
  maxChars?: number
  lexicalBackend?: string
  elasticsearch?: {
    node?: string
    indexPrefix?: string
    apiKey?: string
  }
  vectorBackend?: 'off' | 'cloud'
  vector?: {
    provider?: string
    model?: string
    vectorK?: number
    embedQuery?: boolean
  }
  claimFlash?: boolean
  summarizationModel?: string
  extractors?: string[]
  mediaCaption?: boolean
  windowCompact?: boolean
  windowPendingPattern?: string
  supersedePattern?: string
  trimToolResults?: boolean
  maxToolResultChars?: number
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  inject: z.boolean().default(true),
  tools: z.boolean().default(true),
  dbRelativePath: z.string().default('.dsh/flywheel/index.sqlite'),
  ftsK: z.number().step(1).min(1).default(8),
  hop: z.const(1).default(1),
  hopExtra: z.number().step(1).min(0).default(5),
  maxChars: z.number().step(1).min(500).max(8000).default(3000),
  lexicalBackend: z.string().default('sqlite-fts'),
  elasticsearch: z.object({
    node: z.string().default('http://127.0.0.1:9200'),
    indexPrefix: z.string().default('dsh-flywheel'),
    apiKey: z.string().role('secret'),
  }),
  vectorBackend: z.union([z.const('off'), z.const('cloud')]).default('off'),
  vector: z.object({
    provider: z.string().default(''),
    model: z.string().default(''),
    vectorK: z.number().step(1).min(1).default(8),
    embedQuery: z.boolean().default(false),
  }),
  claimFlash: z.boolean().default(true),
  summarizationModel: z.string().default('deepseek-v4-flash'),
  extractors: z.array(z.string()).default(['generic']),
  mediaCaption: z.boolean().default(false),
  windowCompact: z.boolean().default(true),
  windowPendingPattern: z.string().default('另外|换个|新需求|先不管刚才|开始实现|开始写代码'),
  supersedePattern: z.string().default('不对|不是|改成|作废|作废上次|取消刚才|不要按上次|口径改了|需求变了'),
  trimToolResults: z.boolean().default(true),
  maxToolResultChars: z.number().step(1).min(1000).max(32000).default(8000),
})

/** Merge the settings section (schema-defaulted) over the core constants. */
export function resolveConfig(config: Config): FlywheelConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    elasticsearch: { ...DEFAULT_CONFIG.elasticsearch, ...config.elasticsearch },
    vector: { ...DEFAULT_CONFIG.vector, ...config.vector },
    extractors: config.extractors ?? DEFAULT_CONFIG.extractors,
  }
}
