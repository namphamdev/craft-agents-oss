/**
 * ElectronAdapter - Wraps window.electronAPI for use with AppAdapter
 *
 * This adapter translates the AppAdapter interface to Electron IPC calls.
 * Used by the Electron desktop app's renderer process.
 *
 * Usage:
 * ```tsx
 * import { createElectronAdapter } from '@craft-agent/ui/adapters/electron'
 *
 * const adapter = createElectronAdapter()
 * <AppAdapterProvider value={adapter}>
 *   <App />
 * </AppAdapterProvider>
 * ```
 */

import type { AppAdapter } from '../context/AppAdapter'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Create an ElectronAdapter from window.electronAPI
 *
 * This maps the AppAdapter interface to the existing ElectronAPI.
 * Platform actions (onOpenFile, onOpenUrl, etc.) are also included.
 *
 * Note: We use `any` casts because the full ElectronAPI type lives in
 * apps/electron/src/shared/types.ts. Importing it here would couple
 * the shared UI package to Electron-specific types. The adapter pattern
 * provides type safety at the AppAdapter boundary instead.
 */
export function createElectronAdapter(): AppAdapter {
  const api = (window as any).electronAPI
  if (!api) {
    throw new Error('createElectronAdapter: window.electronAPI is not available. Are you running in Electron?')
  }

  return {
    // -- Platform actions (display/navigation) --
    onOpenFile: (path: string) => api.openFile(path),
    onOpenFileExternal: (path: string) => api.openFile(path),
    onOpenUrl: (url: string) => api.openUrl(url),
    onCopyToClipboard: (text: string) => navigator.clipboard.writeText(text),
    onRevealInFinder: (path: string) => api.showInFolder(path),
    onSetTrafficLightsVisible: (visible: boolean) => api.setTrafficLightsVisible(visible),

    // -- Session management --
    createSession: (workspaceId, options) => api.createSession(workspaceId, options),
    listSessions: () => api.getSessions(),
    getSession: (sessionId) => api.getSessionMessages(sessionId),
    deleteSession: (sessionId) => api.deleteSession(sessionId),
    renameSession: (sessionId, name) =>
      api.sessionCommand(sessionId, { type: 'rename', name }),

    // -- Chat --
    sendMessage: (sessionId, message, attachments, storedAttachments, options) =>
      api.sendMessage(sessionId, message, attachments, storedAttachments, options),
    cancelProcessing: (sessionId) => api.cancelProcessing(sessionId),
    onSessionEvent: (callback) => api.onSessionEvent(callback),

    // -- Permissions --
    respondToPermission: (sessionId, requestId, allowed, alwaysAllow) =>
      api.respondToPermission(sessionId, requestId, allowed, alwaysAllow),
    respondToCredential: (sessionId, requestId, response) =>
      api.respondToCredential(sessionId, requestId, response),
    getPermissionMode: async (sessionId) => {
      const result = await api.sessionCommand(sessionId, { type: 'getPermissionMode' })
      return result
    },
    setPermissionMode: (sessionId, mode) =>
      api.sessionCommand(sessionId, { type: 'setPermissionMode', mode }),

    // -- Workspaces --
    getWorkspaces: () => api.getWorkspaces(),

    // -- Sources --
    getSources: (workspaceId) => api.getSources(workspaceId),
    onSourcesChanged: (callback) => api.onSourcesChanged(callback),

    // -- Skills --
    getSkills: (workspaceId) => api.getSkills(workspaceId),

    // -- Session commands --
    sessionCommand: (sessionId, command) => api.sessionCommand(sessionId, command),

    // -- Config --
    getModel: () => api.getModel(),
    setModel: (model) => api.setModel(model),
    getSessionModel: (sessionId, workspaceId) =>
      api.getSessionModel(sessionId, workspaceId),
    setSessionModel: (sessionId, workspaceId, model) =>
      api.setSessionModel(sessionId, workspaceId, model),

    // -- Theme --
    getSystemTheme: () => api.getSystemTheme(),
    onSystemThemeChange: (callback) => api.onSystemThemeChange(callback),
  }
}
