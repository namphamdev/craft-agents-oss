import { defineRoute, type Route } from './server'
import type { SessionManager } from '../sessions'

/**
 * Create all API route handlers for the WebBridge MVP.
 * Maps REST endpoints to SessionManager methods.
 */
export function createRoutes(sessionManager: SessionManager): Route[] {
  return [
    // GET /api/sessions — list all sessions (metadata only)
    defineRoute('GET', '/api/sessions', async () => {
      return sessionManager.getSessions()
    }),

    // POST /api/sessions — create a new session
    // Body: { workspaceId: string, options?: CreateSessionOptions }
    defineRoute('POST', '/api/sessions', async (_params, body) => {
      const { workspaceId, options } = body as { workspaceId: string; options?: unknown }
      if (!workspaceId) throw new Error('workspaceId is required')
      return sessionManager.createSession(workspaceId, options as never)
    }),

    // GET /api/sessions/:id/messages — get a session with all messages (lazy load)
    defineRoute('GET', '/api/sessions/:id/messages', async (params) => {
      const session = await sessionManager.getSession(params.id)
      if (!session) throw new Error(`Session ${params.id} not found`)
      return session
    }),

    // POST /api/sessions/:id/messages — send a message
    // Body: { message: string, options?: SendMessageOptions }
    // Note: No file attachments for MVP
    defineRoute('POST', '/api/sessions/:id/messages', async (params, body) => {
      const { message, options } = body as { message: string; options?: unknown }
      if (!message) throw new Error('message is required')
      // sendMessage is fire-and-forget — results come via WebSocket events
      sessionManager.sendMessage(params.id, message, undefined, undefined, options as never).catch(() => {
        // Errors are sent via session events
      })
      return { started: true }
    }),

    // POST /api/sessions/:id/cancel — cancel processing
    defineRoute('POST', '/api/sessions/:id/cancel', async (params, body) => {
      const { silent } = (body as { silent?: boolean }) || {}
      await sessionManager.cancelProcessing(params.id, silent)
      return { success: true }
    }),

    // POST /api/sessions/:id/command — consolidated session command
    // Body: SessionCommand (e.g., { type: 'flag' }, { type: 'rename', name: '...' })
    defineRoute('POST', '/api/sessions/:id/command', async (params, body) => {
      const command = body as Record<string, unknown>
      if (!command?.type) throw new Error('command.type is required')
      const sid = params.id
      switch (command.type) {
        case 'flag':
          return sessionManager.flagSession(sid)
        case 'unflag':
          return sessionManager.unflagSession(sid)
        case 'rename':
          return sessionManager.renameSession(sid, command.name as string)
        case 'setTodoState':
          return sessionManager.setTodoState(sid, command.state as string)
        case 'markRead':
          return sessionManager.markSessionRead(sid)
        case 'markUnread':
          return sessionManager.markSessionUnread(sid)
        case 'setActiveViewing':
          return sessionManager.setActiveViewingSession(sid, command.workspaceId as string)
        case 'setPermissionMode':
          return sessionManager.setSessionPermissionMode(sid, command.mode as never)
        case 'setThinkingLevel':
          return sessionManager.setSessionThinkingLevel(sid, command.level as never)
        case 'updateWorkingDirectory':
          return sessionManager.updateWorkingDirectory(sid, command.dir as string)
        case 'setSources':
          return sessionManager.setSessionSources(sid, command.sourceSlugs as string[])
        case 'setLabels':
          return sessionManager.setSessionLabels(sid, command.labels as string[])
        case 'refreshTitle':
          return sessionManager.refreshTitle(sid)
        default:
          throw new Error(`Unknown session command: ${command.type}`)
      }
    }),

    // POST /api/sessions/:id/permission — respond to permission request
    // Body: { requestId: string, allowed: boolean, alwaysAllow: boolean }
    defineRoute('POST', '/api/sessions/:id/permission', async (params, body) => {
      const { requestId, allowed, alwaysAllow } = body as { requestId: string; allowed: boolean; alwaysAllow: boolean }
      if (!requestId) throw new Error('requestId is required')
      const delivered = sessionManager.respondToPermission(params.id, requestId, allowed, alwaysAllow ?? false)
      return { delivered }
    }),

    // POST /api/sessions/:id/credential — respond to credential request
    // Body: { requestId: string, response: CredentialResponse }
    defineRoute('POST', '/api/sessions/:id/credential', async (params, body) => {
      const { requestId, response } = body as { requestId: string; response: unknown }
      if (!requestId) throw new Error('requestId is required')
      const delivered = await sessionManager.respondToCredential(params.id, requestId, response as never)
      return { delivered }
    }),

    // DELETE /api/sessions/:id — delete a session
    defineRoute('DELETE', '/api/sessions/:id', async (params) => {
      await sessionManager.deleteSession(params.id)
      return { success: true }
    }),

    // GET /api/workspaces — list workspaces
    defineRoute('GET', '/api/workspaces', async () => {
      return sessionManager.getWorkspaces()
    }),

    // GET /api/tasks/:id/output — get background task output
    defineRoute('GET', '/api/tasks/:id/output', async (params) => {
      const output = await sessionManager.getTaskOutput(params.id)
      return { output }
    }),
  ]
}
