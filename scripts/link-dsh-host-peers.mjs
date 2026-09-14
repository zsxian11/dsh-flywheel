#!/usr/bin/env node
/**
 * Linked out-of-repo packages are realpath'd by Node ESM, so they cannot walk
 * `$DSH_HOME/profiles/node_modules` (the shared DSH module fallback). This
 * script mirrors missing `@deepseek-ai/*` peerDependencies into
 * `packages/dsh-bundle/node_modules` without touching pnpm-managed entries
 * (cordis / schemastery). npm-installed bundles do not need this: their
 * realpath already sits under the profile tree.
 *
 * Windows cannot create directory symlinks without Developer Mode; the same
 * `'junction'` type DSH uses for its fallback is ignored on POSIX.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundleDir = join(root, 'packages', 'dsh-bundle')
const manifest = JSON.parse(readFileSync(join(bundleDir, 'package.json'), 'utf8'))
const peers = Object.keys(manifest.peerDependencies ?? {}).filter((name) => name.startsWith('@deepseek-ai/'))

function expandHomePath(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

function dshHome() {
  const fromEnv = process.env.DSH_HOME
  const raw = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')
  return resolve(expandHomePath(raw))
}

function canonicalLinkPath(path) {
  try {
    return join(realpathSync.native(dirname(path)), basename(path))
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

function symlinkPointsTo(link, target) {
  const actual = canonicalLinkPath(resolve(dirname(link), readlinkSync(link)))
  const expected = canonicalLinkPath(resolve(target))
  if (actual === undefined || expected === undefined) return false
  if (actual === expected) return true
  return process.platform === 'win32' && actual.toLowerCase() === expected.toLowerCase()
}

function isPnpmManaged(link) {
  try {
    const stat = lstatSync(link)
    if (!stat.isSymbolicLink()) return true
    return readlinkSync(link).replaceAll('\\', '/').includes('.pnpm')
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

function ensureSymlink(link, target) {
  mkdirSync(dirname(link), { recursive: true })
  try {
    const stat = lstatSync(link)
    if (stat.isSymbolicLink() && symlinkPointsTo(link, target)) return 'ok'
    if (!stat.isSymbolicLink()) return 'skip'
    unlinkSync(link)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  symlinkSync(target, link, 'junction')
  return 'linked'
}

const fallbackRoot = join(dshHome(), 'profiles', 'node_modules')
if (!existsSync(fallbackRoot)) {
  console.warn(`link-dsh-host-peers: no shared fallback at ${fallbackRoot}; launch dsh once, then re-run`)
  process.exit(0)
}

let linked = 0
let missing = 0
for (const name of peers) {
  const target = join(fallbackRoot, name)
  const link = join(bundleDir, 'node_modules', name)
  if (!existsSync(target)) {
    console.warn(`link-dsh-host-peers: skip ${name} (not in fallback)`)
    missing += 1
    continue
  }
  if (isPnpmManaged(link)) continue
  const result = ensureSymlink(link, target)
  if (result === 'linked') {
    console.log(`link-dsh-host-peers: ${name}`)
    linked += 1
  }
}

if (missing > 0 && linked === 0) {
  console.warn('link-dsh-host-peers: no peers linked')
}
