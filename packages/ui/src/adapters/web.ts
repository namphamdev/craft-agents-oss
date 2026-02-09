/**
 * WebAdapter - HTTP/SSE adapter for the web app
 *
 * This adapter translates the AppAdapter interface to HTTP REST calls
 * and Server-Sent Events (SSE) for streaming.
 *
 * Usage:
 * ```tsx
 * import { createWebAdapter } from '@craft-agent/ui/adapters/web'
 *
 * const adapter = createWebAdapter({ baseUrl: '/api' })
 * <AppAdapterProvider value={adapter}>
 *   <App />
 * </AppAdapterProvider>
 * ```
 */

import type {
  AppAdapter,
  SessionEvent,
  CreateSessionOptions,
  SendMessageOptions,
  FileAttachment,
  StoredAttachment,
  CredentialResponse,
  PermissionMode,
  LoadedSource,
  LoadedSkill,
  WorkspaceInfo,
} from '../context/AppAdapter'
import type { Session, SessionMetadata, Message, TokenUsage } from '@craft-agent/core'

export interface WebAdapterConfig {
  /** Base URL for API calls (e.g., '/api' or 'https://myserver.com/api') */
  baseUrl: string
  /** Auth token for API requests */
  authToken?: string
}

/**
 * Create a WebAdapter for the browser-based app
 */
export function createWebAdapter(config: WebAdapterConfig): AppAdapter {
  const { baseUrl } = config

  function headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (config.authToken) {
      h['Authorization'] = `Bearer ${config.authToken}`
    }
    return h
  }

  async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: headers(),
      ...init,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`API error ${res.status}: ${text}`)
    }
    return res.json()
  }

  // SSE event source management
  let eventSource: EventSource | null = null
  const eventListeners = new Set<(event: SessionEvent) => void>()

  function ensureEventSource() {
    if (eventSource) return

    const url = config.authToken
      ? `${baseUrl}/events?token=${encodeURIComponent(config.authToken)}`
      : `${baseUrl}/events`

    eventSource = new EventSource(url)

    eventSource.addEventListener('session_event', (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data) as SessionEvent
        for (const listener of eventListeners) {
          listener(event)
        }
      } catch {
        // ignore parse errors
      }
    })

    eventSource.onerror = () => {
      // Auto-reconnect is built into EventSource
      // Could add exponential backoff here if needed
    }
  }

  return {
    // -- Platform actions --
    onOpenUrl: (url) => { window.open(url, '_blank') },
    onCopyToClipboard: (text) => navigator.clipboard.writeText(text),

    // -- Session management --
    createSession: (workspaceId, options) =>
      fetchJSON('/sessions', {
        method: 'POST',
        body: JSON.stringify({ workspaceId, ...options }),
      }),

    listSessions: (workspaceId) =>
      fetchJSON(`/workspaces/${workspaceId}/sessions`),

    getSession: (sessionId) =>
      fetchJSON(`/sessions/${sessionId}`),

    deleteSession: (sessionId) =>
      fetchJSON(`/sessions/${sessionId}`, { method: 'DELETE' }),

    renameSession: (sessionId, name) =>
      fetchJSON(`/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),

    // -- Chat --
    sendMessage: async (sessionId, message, attachments, storedAttachments, options) => {
      await fetchJSON(`/sessions/${sessionId}/chat`, {
        method: 'POST',
        body: JSON.stringify({ message, attachments, storedAttachments, ...options }),
      })
    },

    cancelProcessing: (sessionId) =>
      fetchJSON(`/sessions/${sessionId}/interrupt`, { method: 'POST' }),

    onSessionEvent: (callback) => {
      ensureEventSource()
      eventListeners.add(callback)
      return () => {
        eventListeners.delete(callback)
        if (eventListeners.size === 0 && eventSource) {
          eventSource.close()
          eventSource = null
        }
      }
    },

    // -- Permissions --
    respondToPermission: (sessionId, requestId, allowed, alwaysAllow) =>
      fetchJSON(`/sessions/${sessionId}/permission`, {
        method: 'POST',
        body: JSON.stringify({ requestId, allowed, alwaysAllow }),
      }),

    respondToCredential: (sessionId, requestId, response) =>
      fetchJSON(`/sessions/${sessionId}/credential`, {
        method: 'POST',
        body: JSON.stringify({ requestId, ...response }),
      }),

    getPermissionMode: (sessionId) =>
      fetchJSON(`/sessions/${sessionId}/permission-mode`),

    setPermissionMode: (sessionId, mode) =>
      fetchJSON(`/sessions/${sessionId}/permission-mode`, {
        method: 'PUT',
        body: JSON.stringify({ mode }),
      }),

    // -- Workspaces --
    getWorkspaces: () => fetchJSON('/workspaces'),

    // -- Sources --
    getSources: (workspaceId) =>
      fetchJSON(`/workspaces/${workspaceId}/sources`),

    // -- Skills --
    getSkills: (workspaceId) =>
      fetchJSON(`/workspaces/${workspaceId}/skills`),

    // -- Config --
    getModel: () => fetchJSON('/config/model'),
    setModel: (model) =>
      fetchJSON('/config/model', {
        method: 'PUT',
        body: JSON.stringify({ model }),
      }),

    // -- Theme --
    getSystemTheme: async () => {
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
    },
    onSystemThemeChange: (callback) => {
      const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
      if (!mq) return () => {}
      const handler = (e: MediaQueryListEvent) => callback(e.matches)
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    },
  }
}
