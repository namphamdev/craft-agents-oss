/**
 * Context exports for @craft-agent/ui
 */

export {
  PlatformProvider,
  usePlatform,
  type PlatformActions,
  type PlatformProviderProps,
} from './PlatformContext'

export {
  ShikiThemeProvider,
  useShikiTheme,
  type ShikiThemeProviderProps,
} from './ShikiThemeContext'

export {
  AppAdapterProvider,
  useAppAdapter,
  useOptionalAppAdapter,
  type AppAdapter,
  type CreateSessionOptions,
  type SendMessageOptions,
  type FileAttachment as AdapterFileAttachment,
  type StoredAttachment as AdapterStoredAttachment,
  type CredentialResponse as AdapterCredentialResponse,
  type PermissionMode as AdapterPermissionMode,
  type ThinkingLevel as AdapterThinkingLevel,
  type LoadedSource as AdapterLoadedSource,
  type LoadedSkill as AdapterLoadedSkill,
  type SessionEvent as AdapterSessionEvent,
  type WorkspaceInfo,
} from './AppAdapter'
