/**
 * Web Server for Craft Agents
 *
 * Wraps @craft-agent/shared to provide HTTP REST + SSE endpoints
 * for the browser-based web app. This is a thin adapter between
 * HTTP and the same business logic used by the Electron main process.
 *
 * Endpoints:
 *   GET  /api/workspaces                  - List workspaces
 *   GET  /api/workspaces/:id/sessions     - List sessions
 *   GET  /api/workspaces/:id/sources      - List sources
 *   GET  /api/workspaces/:id/skills       - List skills
 *   POST /api/sessions                    - Create session
 *   GET  /api/sessions/:id                - Get session with messages
 *   DELETE /api/sessions/:id              - Delete session
 *   PATCH /api/sessions/:id               - Update session (rename)
 *   POST /api/sessions/:id/chat           - Send message (triggers SSE events)
 *   POST /api/sessions/:id/interrupt      - Interrupt processing
 *   POST /api/sessions/:id/permission     - Respond to permission request
 *   POST /api/sessions/:id/credential     - Respond to credential request
 *   GET  /api/sessions/:id/permission-mode- Get permission mode
 *   PUT  /api/sessions/:id/permission-mode- Set permission mode
 *   GET  /api/events                      - SSE event stream
 *   GET  /api/config/model                - Get model
 *   PUT  /api/config/model                - Set model
 *
 * Start: bun run apps/web-server/src/index.ts
 */

import {
  CraftAgent,
  type AgentEvent,
  setPermissionMode,
  getPermissionMode,
  AbortReason,
  type PermissionMode,
} from '@craft-agent/shared/agent'
import { getWorkspaces, type Workspace } from '@craft-agent/shared/config'
import {
  listSessions as listStoredSessions,
  loadSession as loadStoredSession,
  createSession as createStoredSession,
  deleteSession as deleteStoredSession,
  updateSessionMetadata,
  type StoredSession,
  type SessionConfig,
} from '@craft-agent/shared/sessions'
import { loadWorkspaceSources } from '@craft-agent/shared/sources'
import { loadWorkspaceSkills } from '@craft-agent/shared/skills'
import { DEFAULT_MODEL } from '@craft-agent/shared/config'
import { DEFAULT_THINKING_LEVEL, type ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'

// ============================================================================
// Types
// ============================================================================

interface ManagedSession {
  agent: CraftAgent
  workspace: Workspace
  sessionConfig: SessionConfig
  isProcessing: boolean
  pendingPermissions: Map<string, (allowed: boolean, alwaysAllow?: boolean) => void>
  pendingCredentials: Map<string, (response: any) => void>
}

interface SSEClient {
  controller: ReadableStreamDefaultController
  sessionFilter?: string
}

// ============================================================================
// State
// ============================================================================

const activeSessions = new Map<string, ManagedSession>()
const sseClients = new Set<SSEClient>()
let globalModel: string | null = null

// ============================================================================
// SSE Broadcasting
// ============================================================================

function broadcastEvent(sessionId: string, event: AgentEvent) {
  const data = JSON.stringify({ sessionId, event })
  const message = `event: session_event\ndata: ${data}\n\n`

  for (const client of sseClients) {
    if (!client.sessionFilter || client.sessionFilter === sessionId) {
      try {
        client.controller.enqueue(new TextEncoder().encode(message))
      } catch {
        sseClients.delete(client)
      }
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function findWorkspace(workspaceId: string): Workspace | null {
  const workspaces = getWorkspaces()
  return workspaces.find(w => w.id === workspaceId) ?? null
}

function findSessionWorkspace(sessionId: string): { workspace: Workspace; session: StoredSession } | null {
  const workspaces = getWorkspaces()
  for (const ws of workspaces) {
    const session = loadStoredSession(ws.rootPath, sessionId)
    if (session) return { workspace: ws, session }
  }
  return null
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status)
}

// ============================================================================
// Route Handler
// ============================================================================

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname
  const method = req.method

  // CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  // ========== SSE Events ==========
  if (method === 'GET' && path === '/api/events') {
    const stream = new ReadableStream({
      start(controller) {
        const client: SSEClient = { controller }
        sseClients.add(client)

        const keepalive = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode(': keepalive\n\n'))
          } catch {
            clearInterval(keepalive)
            sseClients.delete(client)
          }
        }, 30000)

        req.signal.addEventListener('abort', () => {
          clearInterval(keepalive)
          sseClients.delete(client)
        })
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }

  // ========== Workspaces ==========
  if (method === 'GET' && path === '/api/workspaces') {
    const workspaces = getWorkspaces()
    return jsonResponse(workspaces.map(w => ({
      id: w.id,
      name: w.name,
      path: w.rootPath,
    })))
  }

  // ========== Sessions List ==========
  const sessionsMatch = path.match(/^\/api\/workspaces\/([^/]+)\/sessions$/)
  if (method === 'GET' && sessionsMatch) {
    const ws = findWorkspace(sessionsMatch[1])
    if (!ws) return errorResponse('Workspace not found', 404)
    return jsonResponse(listStoredSessions(ws.rootPath))
  }

  // ========== Sources ==========
  const sourcesMatch = path.match(/^\/api\/workspaces\/([^/]+)\/sources$/)
  if (method === 'GET' && sourcesMatch) {
    const ws = findWorkspace(sourcesMatch[1])
    if (!ws) return errorResponse('Workspace not found', 404)

    const sources = loadWorkspaceSources(ws.rootPath) as any[]
    return jsonResponse(sources.map(s => ({
      slug: s.slug,
      name: s.name,
      type: s.type,
      description: s.description,
      isActive: s.isActive ?? false,
      needsAuth: s.needsAuth ?? false,
      provider: s.provider,
    })))
  }

  // ========== Skills ==========
  const skillsMatch = path.match(/^\/api\/workspaces\/([^/]+)\/skills$/)
  if (method === 'GET' && skillsMatch) {
    const ws = findWorkspace(skillsMatch[1])
    if (!ws) return errorResponse('Workspace not found', 404)

    const skills = loadWorkspaceSkills(ws.rootPath) as any[]
    return jsonResponse(skills.map(s => ({
      slug: s.slug,
      name: s.name,
      description: s.description,
    })))
  }

  // ========== Create Session ==========
  if (method === 'POST' && path === '/api/sessions') {
    const body = await req.json() as any
    const { workspaceId } = body
    if (!workspaceId) return errorResponse('workspaceId required')

    const ws = findWorkspace(workspaceId)
    if (!ws) return errorResponse('Workspace not found', 404)

    const sessionConfig = await createStoredSession(ws.rootPath)
    return jsonResponse({
      id: sessionConfig.id,
      workspaceId,
      createdAt: sessionConfig.createdAt,
      lastUsedAt: sessionConfig.lastUsedAt,
    }, 201)
  }

  // ========== Get Session ==========
  const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/)
  if (method === 'GET' && sessionMatch) {
    const found = findSessionWorkspace(sessionMatch[1])
    if (!found) return errorResponse('Session not found', 404)
    return jsonResponse(found.session)
  }

  // ========== Delete Session ==========
  if (method === 'DELETE' && sessionMatch) {
    const sessionId = sessionMatch![1]
    const found = findSessionWorkspace(sessionId)
    if (!found) return errorResponse('Session not found', 404)

    deleteStoredSession(found.workspace.rootPath, sessionId)
    activeSessions.delete(sessionId)
    return jsonResponse({ deleted: true })
  }

  // ========== Rename Session ==========
  if (method === 'PATCH' && sessionMatch) {
    const sessionId = sessionMatch![1]
    const body = await req.json() as any
    const { name } = body
    if (!name) return errorResponse('name required')

    const found = findSessionWorkspace(sessionId)
    if (!found) return errorResponse('Session not found', 404)

    updateSessionMetadata(found.workspace.rootPath, sessionId, { name })
    return jsonResponse({ renamed: true })
  }

  // ========== Send Message (Chat) ==========
  const chatMatch = path.match(/^\/api\/sessions\/([^/]+)\/chat$/)
  if (method === 'POST' && chatMatch) {
    const sessionId = chatMatch[1]
    const body = await req.json() as any
    const { message, model, thinkingLevel } = body

    if (!message) return errorResponse('message required')

    const found = findSessionWorkspace(sessionId)
    if (!found) return errorResponse('Session not found', 404)

    const { workspace: targetWorkspace, session: storedSession } = found

    // Get or create managed session
    let managed = activeSessions.get(sessionId)
    if (!managed) {
      const sessionConfig: SessionConfig = {
        id: sessionId,
        sdkSessionId: storedSession.sdkSessionId,
        workspaceRootPath: targetWorkspace.rootPath,
        createdAt: storedSession.createdAt,
        lastUsedAt: storedSession.lastUsedAt,
      }

      const agent = new CraftAgent({
        workspace: targetWorkspace,
        session: sessionConfig,
        model: model || globalModel || DEFAULT_MODEL,
        thinkingLevel: (thinkingLevel as ThinkingLevel) || DEFAULT_THINKING_LEVEL,
        onSdkSessionIdUpdate: (sdkSessionId: string) => {
          updateSessionMetadata(targetWorkspace.rootPath, sessionId, { sdkSessionId } as any)
        },
      })

      managed = {
        agent,
        workspace: targetWorkspace,
        sessionConfig,
        isProcessing: false,
        pendingPermissions: new Map(),
        pendingCredentials: new Map(),
      }
      activeSessions.set(sessionId, managed)
    }

    if (managed.isProcessing) {
      return errorResponse('Session is already processing', 409)
    }

    managed.isProcessing = true

    // Process in background — events stream via SSE
    const capturedManaged = managed
    ;(async () => {
      try {
        for await (const event of capturedManaged.agent.chat(message)) {
          broadcastEvent(sessionId, event)

          if (event.type === 'permission_request') {
            const { requestId } = event
            await new Promise<void>((resolveWait) => {
              capturedManaged.pendingPermissions.set(requestId, (allowed, alwaysAllow) => {
                capturedManaged.agent.respondToPermission(requestId, allowed, alwaysAllow ?? false)
                resolveWait()
              })
            })
          }
        }
      } catch (err) {
        broadcastEvent(sessionId, {
          type: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        })
      } finally {
        capturedManaged.isProcessing = false
        broadcastEvent(sessionId, { type: 'complete' })
      }
    })()

    return jsonResponse({ started: true })
  }

  // ========== Interrupt ==========
  const interruptMatch = path.match(/^\/api\/sessions\/([^/]+)\/interrupt$/)
  if (method === 'POST' && interruptMatch) {
    const sessionId = interruptMatch[1]
    const managed = activeSessions.get(sessionId)
    if (!managed) return errorResponse('Session not active', 404)

    managed.agent.forceAbort(AbortReason.UserStop)
    return jsonResponse({ interrupted: true })
  }

  // ========== Permission Response ==========
  const permMatch = path.match(/^\/api\/sessions\/([^/]+)\/permission$/)
  if (method === 'POST' && permMatch) {
    const sessionId = permMatch[1]
    const managed = activeSessions.get(sessionId)
    if (!managed) return errorResponse('Session not active', 404)

    const body = await req.json() as any
    const { requestId, allowed, alwaysAllow } = body
    const resolve = managed.pendingPermissions.get(requestId)
    if (resolve) {
      resolve(allowed, alwaysAllow)
      managed.pendingPermissions.delete(requestId)
      return jsonResponse({ responded: true })
    }
    return errorResponse('Permission request not found', 404)
  }

  // ========== Credential Response ==========
  const credMatch = path.match(/^\/api\/sessions\/([^/]+)\/credential$/)
  if (method === 'POST' && credMatch) {
    const sessionId = credMatch[1]
    const managed = activeSessions.get(sessionId)
    if (!managed) return errorResponse('Session not active', 404)

    const body = await req.json() as any
    const { requestId, ...response } = body
    const resolve = managed.pendingCredentials.get(requestId)
    if (resolve) {
      resolve(response)
      managed.pendingCredentials.delete(requestId)
      return jsonResponse({ responded: true })
    }
    return errorResponse('Credential request not found', 404)
  }

  // ========== Permission Mode ==========
  const modeMatch = path.match(/^\/api\/sessions\/([^/]+)\/permission-mode$/)
  if (modeMatch) {
    const sessionId = modeMatch[1]

    if (method === 'GET') {
      const mode = getPermissionMode(sessionId)
      return jsonResponse({ mode })
    }

    if (method === 'PUT') {
      const body = await req.json() as any
      const { mode } = body
      setPermissionMode(sessionId, mode as PermissionMode)
      return jsonResponse({ mode })
    }
  }

  // ========== Config: Model ==========
  if (path === '/api/config/model') {
    if (method === 'GET') {
      return jsonResponse({ model: globalModel || DEFAULT_MODEL })
    }
    if (method === 'PUT') {
      const body = await req.json() as any
      globalModel = body.model || null
      return jsonResponse({ model: globalModel })
    }
  }

  // ========== 404 ==========
  return errorResponse('Not found', 404)
}

// ============================================================================
// Server
// ============================================================================

// Use CRAFT_WEB_SERVER_PORT (set by electron:dev) or PORT or default 3100
const PORT = parseInt(process.env.CRAFT_WEB_SERVER_PORT || process.env.PORT || '3100', 10)

console.log(`Starting Craft Agent web server on port ${PORT}...`)

Bun.serve({
  port: PORT,
  fetch: handleRequest,
})

console.log(`Craft Agent web server running at http://localhost:${PORT}`)
console.log(`SSE events at http://localhost:${PORT}/api/events`)
console.log(`API docs at http://localhost:${PORT}/api/workspaces`)
