/**
 * dsh-archived-sessions — host half.
 *
 * DSH has archive but no delete: the archive set lives in the workspace
 * registry (`ctx.workspaceRegistry.archivedSessionIds`) and each session is a
 * directory `~/.dsh/sessions/<encoded-workspace>/session-<id>/`. This plugin
 * exposes two fenced routes under `/dsh-archived-sessions` that the client
 * half calls:
 *
 *   POST list   -> { sessions: [{ id, title, cwd, updatedAt }] }
 *   POST delete -> { deleted: [...], failed: [{ id, message }] }
 *
 * Deleting first drops the id from the archive set (so no ghost row survives)
 * and then removes the session directories. It is deliberately irreversible:
 * the UI asks for confirmation.
 */
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-archived-sessions'
export const inject = ['webServer', 'connection', 'workspaceRegistry']

const PREFIX = '/dsh-archived-sessions'
const MAX_BODY = 1 << 20
const SAFE_ID = /^[A-Za-z0-9._-]+$/

function sessionsRoot() {
  return join(homedir(), '.dsh', 'sessions')
}

/** Diagnostics trail: one JSON line per delete attempt (best effort). */
function logLine(entry) {
  return fs
    .appendFile(join(homedir(), '.dsh', 'archived-sessions.log'), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n')
    .catch(() => {})
}

/** The workspace folder names under the sessions root (diagnostics only). */
async function listWorkspaceDirs() {
  try {
    return (await fs.readdir(sessionsRoot())).slice(0, 20)
  } catch (error) {
    return ['<error: ' + (error instanceof Error ? error.message : String(error)) + '>']
  }
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > MAX_BODY) {
        reject(new Error('request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

/**
 * Every directory holding this session, across workspaces.
 *
 * The sidebar's node id is the DIRECTORY name — `session-<uuid>` — while the
 * registry's plain session id is the bare uuid. Both shapes arrive here, so the
 * candidate names are derived from whichever one was sent.
 */
async function sessionDirsFor(id) {
  const root = sessionsRoot()
  const names = id.startsWith('session-') ? [id] : [`session-${id}`, id]
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const found = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    for (const name of names) {
      const candidate = join(root, entry.name, name)
      try {
        const stat = await fs.stat(candidate)
        if (stat.isDirectory()) found.push(candidate)
      } catch {
        /* not this workspace */
      }
    }
  }
  return found
}

function field(header, ...names) {
  for (const key of names) {
    const value = header?.[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

/** The archived ids plus whatever metadata the registry can supply. */
async function listArchived(ctx) {
  const registry = ctx.workspaceRegistry
  let ids = []
  try {
    ids = [...(registry.archivedSessionIds ?? [])]
  } catch {
    ids = []
  }
  let headers = []
  try {
    headers = typeof registry.listStoredHeaders === 'function' ? await registry.listStoredHeaders() : []
  } catch {
    headers = []
  }
  const byId = new Map((headers ?? []).map((header) => [header.id, header]))
  return ids.map((id) => {
    const header = byId.get(id) ?? {}
    return {
      id,
      title: field(header, 'title', 'name') ?? null,
      cwd: field(header, 'cwd', 'directory', 'path') ?? null,
      updatedAt: field(header, 'updatedAt', 'updated', 'createdAt', 'created') ?? null,
    }
  })
}

/**
 * Make the registry forget sessions whose files are gone.
 *
 * `candidateMatches` answers from an in-memory header index built at boot, so
 * deleting a session log leaves a ghost row: the workspace still claims the id
 * and the sidebar still lists it. Re-reading stored headers and rebuilding the
 * entity cache drops it (the registry itself exposes no "forget" method).
 */
async function reindex(ctx) {
  const registry = ctx.workspaceRegistry
  if (typeof registry.listStoredHeaders !== 'function' || typeof registry.replaceHeaderIndex !== 'function') {
    await logLine({ event: 'reindex-skipped', reason: 'registry lacks reindex surface' })
    return false
  }
  try {
    const headers = await registry.listStoredHeaders()
    await registry.replaceHeaderIndex(headers)
    // Replacing the index drops live sessions too, and the sidebar renders
    // from it — put the running ones back before rebuilding the entities.
    if (typeof registry.indexLiveSessions === 'function') await registry.indexLiveSessions()
    if (typeof registry.rebuildEntities === 'function') registry.rebuildEntities()
    await logLine({ event: 'reindex-ok', headers: headers.length })
    return true
  } catch (error) {
    await logLine({ event: 'reindex-failed', message: error instanceof Error ? error.message : String(error) })
    return false
  }
}

/**
 * Drop one id from the Session-query index.
 *
 * The sidebar list is served by `sessionQuery.listSessions()`, i.e. the SQLite
 * index — NOT by a read of the log directory. Removing the file alone leaves
 * the row there forever, because the index only reconciles when the persistence
 * binding it observes changes. The reconcile entry point is private
 * (`_reconcile`), so it is called defensively and a failure is only logged.
 */
async function reconcileQueryIndex(ctx) {
  let query
  try {
    query = ctx.get('sessionQuery')
  } catch {
    query = undefined
  }
  if (query === undefined || typeof query.listSessions !== 'function') {
    await logLine({ event: 'query-index-skip', reason: 'no listSessions surface' })
    return false
  }
  try {
    // `listSessions` is the public path that opens the index and reconciles it
    // against the persistence backend — running it after the unlink is what
    // purges the deleted session from the sidebar's source of truth.
    const sessions = await query.listSessions()
    await logLine({ event: 'query-index-ok', sessions: Array.isArray(sessions) ? sessions.length : null })
    return true
  } catch (error) {
    await logLine({ event: 'query-index-failed', message: error instanceof Error ? error.message : String(error) })
    return false
  }
}

/** Remove the session's projection-cache file, if the host wrote one. */
async function dropProjectionCache(id) {
  const normalized = id.startsWith('session-') ? id : `session-${id}`
  const file = join(homedir(), '.dsh', 'storages', 'session_projcache', 'sessions', `${normalized}.json`)
  try {
    await fs.rm(file, { force: true })
    await logLine({ event: 'projcache-removed', file })
  } catch {
    /* absent is fine */
  }
}

/**
 * Detach the live copy of a session, if the host still holds one.
 *
 * This is why a just-used conversation survived deletion while a cold one
 * vanished: the live store keeps the session (and its persistence write
 * handle), and the query index counts live sessions — so the sidebar row comes
 * straight back. Archiving releases the main-view reference, so an archived
 * session is never the one the user is looking at; detaching it is safe.
 */
async function detachLive(ctx, id) {
  let sessions
  try {
    sessions = ctx.get('sessions')
  } catch {
    sessions = undefined
  }
  if (sessions === undefined || typeof sessions.get !== 'function') return false
  let live
  try {
    live = sessions.get(id)
  } catch {
    return false
  }
  if (live === undefined) return false
  try {
    const entry = typeof sessions.liveEntryFor === 'function' ? sessions.liveEntryFor(live) : undefined
    if (entry === undefined || typeof sessions.detachEntered !== 'function') {
      await logLine({ event: 'detach-live-skip', id, reason: 'no entry surface' })
      return false
    }
    sessions.detachEntered(entry)
    await logLine({ event: 'detach-live-ok', id })
    return true
  } catch (error) {
    await logLine({ event: 'detach-live-failed', id, message: error instanceof Error ? error.message : String(error) })
    return false
  }
}

async function deleteOne(ctx, id) {
  const root = sessionsRoot()
  const dirs = await sessionDirsFor(id)
  if (dirs.length === 0) {
    // Already gone on disk: a sidebar row can outlive its log (the query index
    // keeps it), and clicking that ghost must still succeed — "not found" would
    // leave the stale row forever.
    await logLine({ event: 'already-gone', id, home: homedir(), root, entries: await listWorkspaceDirs() })
    await detachLive(ctx, id)
    await dropProjectionCache(id)
    try {
      await ctx.workspaceRegistry.unarchiveSession(id)
    } catch {
      /* already out of the archive set / unknown id */
    }
    return { removed: 0, alreadyGone: true }
  }
  await detachLive(ctx, id)
  for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true })
  await dropProjectionCache(id)
  // Only leave the archive set once the files are actually gone.
  try {
    await ctx.workspaceRegistry.unarchiveSession(id)
  } catch {
    /* already unarchived / unknown — the unlink above is what matters */
  }
  await logLine({ event: 'deleted', id, dirs })
  return { removed: dirs.length, alreadyGone: false }
}

export function apply(ctx) {
  void (async () => {
    const root = sessionsRoot()
    let exists = false
    try {
      await fs.access(root)
      exists = true
    } catch {
      exists = false
    }
    await logLine({ event: 'boot', home: homedir(), root, exists, entries: await listWorkspaceDirs() })
  })()

  const trusted = (req) => {
    try {
      return ctx.connection.requestRejection(req) === undefined
    } catch {
      return true
    }
  }

  const handler = async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
    const route = pathname.slice(PREFIX.length).replace(/^\/+/, '')

    if (route === 'delete') await logLine({ event: 'request', method: req.method, url: req.url })

    if (!trusted(req)) {
      if (route === 'delete') {
        await logLine({
          event: 'fence-rejected',
          origin: req.headers?.origin ?? null,
          referer: req.headers?.referer ?? null,
        })
      }
      sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
      return
    }

    try {
      if (route === 'list') {
        // Opening the page also heals a stale index left by an earlier delete.
        await reconcileQueryIndex(ctx)
        sendJson(res, 200, { ok: true, value: { sessions: await listArchived(ctx) } })
        return
      }

      if (route === 'delete') {
        const raw = await readBody(req)
        const payload = raw ? JSON.parse(raw) : {}
        const ids = Array.isArray(payload?.ids) ? payload.ids : []
        await logLine({ event: 'delete-request', ids })
        const deleted = []
        const failed = []
        for (const value of ids) {
          const id = String(value)
          if (!SAFE_ID.test(id)) {
            failed.push({ id, message: 'invalid session id' })
            continue
          }
          try {
            await deleteOne(ctx, id)
            deleted.push(id)
          } catch (error) {
            failed.push({ id, message: error instanceof Error ? error.message : String(error) })
          }
        }
        const reindexed = await reindex(ctx)
        const queryIndex = await reconcileQueryIndex(ctx)
        sendJson(res, 200, { ok: true, value: { deleted, failed, reindexed, queryIndex } })
        return
      }

      sendJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown route' } })
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: { code: 'internal', message: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler }),
    'dsh-archived-sessions: routes',
  )
}
