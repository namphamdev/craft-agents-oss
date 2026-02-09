/**
 * AppAdapter - Abstraction layer for platform-specific application logic
 *
 * This extends PlatformActions (which handles read-only/display actions) with
 * interactive capabilities needed for the full app experience: session management,
 * chat messaging, configuration, sources, etc.
 *
 * Implementations:
 * - ElectronAdapter: wraps window.electronAPI IPC calls
 * - WebAdapter: wraps HTTP/SSE calls to the web server
 *
 * Components use useAppAdapter() to access the adapter.
 * The adapter is optional — components that only need PlatformActions
 * should continue using usePlatform().
 */

import { createContext, useContext } from 'react'
import type { PlatformActions } from './PlatformContext'
import type {
  Session,
  SessionMetadata,
  Message,
  AgentEvent,
  TokenUsage,
  PermissionRequest,
} from '@craft-agent/core'

// ============================================================================
// Types used by the adapter (subset of Electron shared/types.ts)
// ============================================================================

/**
 * Options when creating a session
 */
export interface CreateSessionOptions {
  /** Initial user message to send immediately after creation */
  initialMessage?: string
  /** Working directory override */
  workingDirectory?: string
  /** Skill to invoke (e.g., "my-workspace:commit") */
  skillSlug?: string
}

/**
 * Options when sending a message
 */
export interface SendMessageOptions {
  /** Model override for this message */
  model?: string
  /** Thinking level override */
  thinkingLevel?: string
  /** Whether this is a retry of a failed message */
  isRetry?: boolean
}

/**
 * File attachment for user messages
 */
export interface FileAttachment {
  name: string
  mimeType: string
  size: number
  base64: string
}

/**
 * Stored attachment metadata (persisted, no base64)
 */
export interface StoredAttachment {
  id: string
  name: string
  mimeType: string
  size: number
  storedPath: string
  thumbnailBase64?: string
}

/**
 * Credential response from user
 */
export interface CredentialResponse {
  type: 'credential'
  credential?: string
  username?: string
  password?: string
  cancelled?: boolean
  headers?: Record<string, string>
}

/**
 * Permission mode for sessions
 */
export type PermissionMode = 'safe' | 'ask' | 'allow-all'

/**
 * Thinking level for extended thinking
 */
export type ThinkingLevel = 'off' | 'think' | 'max'

/**
 * Loaded source from workspace
 */
export interface LoadedSource {
  slug: string
  name: string
  type: 'mcp' | 'api' | 'local'
  description?: string
  iconBase64?: string
  isActive: boolean
  needsAuth: boolean
  provider?: string
}

/**
 * Loaded skill from workspace
 */
export interface LoadedSkill {
  slug: string
  name: string
  description?: string
  iconBase64?: string
}

/**
 * Session event dispatched from backend
 */
export interface SessionEvent {
  sessionId: string
  event: AgentEvent
}

/**
 * Workspace info
 */
export interface WorkspaceInfo {
  id: string
  name: string
  path?: string
  iconUrl?: string
}

// ============================================================================
// AppAdapter interface
// ============================================================================

/**
 * Full application adapter interface.
 * Extends PlatformActions with interactive capabilities.
 */
export interface AppAdapter extends PlatformActions {
  // -- Session management --

  /** Create a new session in a workspace */
  createSession(workspaceId: string, options?: CreateSessionOptions): Promise<Session>

  /** List session metadata for a workspace */
  listSessions(workspaceId: string): Promise<SessionMetadata[]>

  /** Get a full session with messages */
  getSession(sessionId: string): Promise<Session & { messages: Message[]; tokenUsage?: TokenUsage } | null>

  /** Delete a session */
  deleteSession(sessionId: string): Promise<void>

  /** Rename a session */
  renameSession(sessionId: string, name: string): Promise<void>

  // -- Chat --

  /** Send a message and receive streaming events via callback */
  sendMessage(
    sessionId: string,
    message: string,
    attachments?: FileAttachment[],
    storedAttachments?: StoredAttachment[],
    options?: SendMessageOptions,
  ): Promise<void>

  /** Cancel/interrupt the current processing */
  cancelProcessing(sessionId: string): Promise<void>

  /** Subscribe to session events (streaming tokens, tool calls, etc.) */
  onSessionEvent(callback: (event: SessionEvent) => void): () => void

  // -- Permissions --

  /** Respond to a permission request */
  respondToPermission(
    sessionId: string,
    requestId: string,
    allowed: boolean,
    alwaysAllow: boolean,
  ): Promise<void>

  /** Respond to a credential request */
  respondToCredential(
    sessionId: string,
    requestId: string,
    response: CredentialResponse,
  ): Promise<void>

  /** Get permission mode for a session */
  getPermissionMode(sessionId: string): Promise<PermissionMode>

  /** Set permission mode for a session */
  setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void>

  // -- Workspaces --

  /** List available workspaces */
  getWorkspaces(): Promise<WorkspaceInfo[]>

  // -- Sources --

  /** List sources for a workspace */
  getSources(workspaceId: string): Promise<LoadedSource[]>

  /** Subscribe to source changes */
  onSourcesChanged?(callback: (sources: LoadedSource[]) => void): () => void

  // -- Skills --

  /** List skills for a workspace */
  getSkills(workspaceId: string): Promise<LoadedSkill[]>

  // -- Session metadata commands --

  /** Update session metadata (flag, archive, status, etc.) */
  sessionCommand?(
    sessionId: string,
    command: Record<string, unknown>,
  ): Promise<void>

  // -- Config --

  /** Get the global model setting */
  getModel?(): Promise<string | null>

  /** Set the global model */
  setModel?(model: string): Promise<void>

  /** Get session-specific model override */
  getSessionModel?(sessionId: string, workspaceId: string): Promise<string | null>

  /** Set session-specific model override */
  setSessionModel?(sessionId: string, workspaceId: string, model: string | null): Promise<void>

  // -- Theme --

  /** Get system dark mode preference */
  getSystemTheme?(): Promise<boolean>

  /** Subscribe to system theme changes */
  onSystemThemeChange?(callback: (isDark: boolean) => void): () => void
}

// ============================================================================
// React Context
// ============================================================================

const AppAdapterContext = createContext<AppAdapter | null>(null)

export const AppAdapterProvider = AppAdapterContext.Provider

/**
 * useAppAdapter - Access the app adapter in components
 *
 * Throws if no adapter is provided (use in interactive app only).
 *
 * ```tsx
 * const adapter = useAppAdapter()
 * await adapter.sendMessage(sessionId, text)
 * ```
 */
export function useAppAdapter(): AppAdapter {
  const adapter = useContext(AppAdapterContext)
  if (!adapter) {
    throw new Error(
      'useAppAdapter must be used within an AppAdapterProvider. ' +
      'Wrap your app with <AppAdapterProvider value={adapter}>.',
    )
  }
  return adapter
}

/**
 * useOptionalAppAdapter - Access the app adapter if available
 *
 * Returns null if no adapter is provided (safe for read-only components).
 */
export function useOptionalAppAdapter(): AppAdapter | null {
  return useContext(AppAdapterContext)
}
