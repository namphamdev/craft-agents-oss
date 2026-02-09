/**
 * Adapter exports for @craft-agent/ui
 *
 * Adapters provide platform-specific implementations of AppAdapter.
 */

export { createElectronAdapter } from './electron'
export { createWebAdapter, type WebAdapterConfig } from './web'
