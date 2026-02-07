/**
 * AppSettingsPage
 *
 * Global app-level settings that apply across all workspaces.
 *
 * Settings:
 * - Notifications
 * - API Connection (opens OnboardingWizard for editing)
 * - About (version, updates)
 *
 * Note: Appearance settings (theme, font) have been moved to AppearanceSettingsPage.
 */

import { useState, useEffect, useCallback } from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import { X } from 'lucide-react'
import { Spinner, FullscreenOverlayBase } from '@craft-agent/ui'
import { useSetAtom } from 'jotai'
import { fullscreenOverlayOpenAtom } from '@/atoms/overlay'
import type { AuthType } from '../../../shared/types'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
} from '@/components/settings'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'
import { useOnboarding } from '@/hooks/useOnboarding'
import { OnboardingWizard } from '@/components/onboarding'
import { useAppShellContext } from '@/context/AppShellContext'
import { Copy, Check, ExternalLink } from 'lucide-react'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'app',
}

// ============================================
// Main Component
// ============================================

export default function AppSettingsPage() {
  const { refreshCustomModel } = useAppShellContext()

  // API Connection state (read-only display — editing is done via OnboardingWizard overlay)
  const [authType, setAuthType] = useState<AuthType>('api_key')
  const [hasCredential, setHasCredential] = useState(false)
  const [showApiSetup, setShowApiSetup] = useState(false)
  const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom)

  // Notifications state
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // Auto-update state
  const updateChecker = useUpdateChecker()
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false)

  // Web Bridge state
  const [webBridgeInfo, setWebBridgeInfo] = useState<{ running: boolean; url: string | null; token: string | null }>({ running: false, url: null, token: null })
  const [copiedField, setCopiedField] = useState<'url' | 'token' | null>(null)

  const handleCheckForUpdates = useCallback(async () => {
    setIsCheckingForUpdates(true)
    try {
      await updateChecker.checkForUpdates()
    } finally {
      setIsCheckingForUpdates(false)
    }
  }, [updateChecker])

  // Load current API connection info and notifications on mount
  const loadConnectionInfo = useCallback(async () => {
    if (!window.electronAPI) return
    try {
      const [billing, notificationsOn, bridgeInfo] = await Promise.all([
        window.electronAPI.getApiSetup(),
        window.electronAPI.getNotificationsEnabled(),
        window.electronAPI.getWebBridgeInfo(),
      ])
      setAuthType(billing.authType)
      setHasCredential(billing.hasCredential)
      setNotificationsEnabled(notificationsOn)
      setWebBridgeInfo(bridgeInfo)
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }, [])

  useEffect(() => {
    loadConnectionInfo()
  }, [])

  // Helpers to open/close the fullscreen API setup overlay
  const openApiSetup = useCallback(() => {
    setShowApiSetup(true)
    setFullscreenOverlayOpen(true)
  }, [setFullscreenOverlayOpen])

  const closeApiSetup = useCallback(() => {
    setShowApiSetup(false)
    setFullscreenOverlayOpen(false)
  }, [setFullscreenOverlayOpen])

  // OnboardingWizard hook for editing API connection (starts at api-setup step).
  // onConfigSaved fires immediately when billing is persisted, updating the model UI instantly.
  const apiSetupOnboarding = useOnboarding({
    initialStep: 'api-setup',
    onConfigSaved: refreshCustomModel,
    onComplete: () => {
      closeApiSetup()
      loadConnectionInfo()
      apiSetupOnboarding.reset()
    },
    onDismiss: () => {
      closeApiSetup()
      apiSetupOnboarding.reset()
    },
  })

  // Called when user completes the wizard (clicks Finish on completion step)
  const handleApiSetupFinish = useCallback(() => {
    closeApiSetup()
    loadConnectionInfo()
    apiSetupOnboarding.reset()
  }, [closeApiSetup, loadConnectionInfo, apiSetupOnboarding])

  const handleNotificationsEnabledChange = useCallback(async (enabled: boolean) => {
    setNotificationsEnabled(enabled)
    await window.electronAPI.setNotificationsEnabled(enabled)
  }, [])

  const copyToClipboard = useCallback(async (text: string, field: 'url' | 'token') => {
    await navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }, [])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="App Settings" actions={<HeaderMenu route={routes.view.settings('app')} helpFeature="app-settings" />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
          <div className="space-y-8">
            {/* Notifications */}
            <SettingsSection title="Notifications">
              <SettingsCard>
                <SettingsToggle
                  label="Desktop notifications"
                  description="Get notified when AI finishes working in a chat."
                  checked={notificationsEnabled}
                  onCheckedChange={handleNotificationsEnabledChange}
                />
              </SettingsCard>
            </SettingsSection>

            {/* API Connection */}
            <SettingsSection title="API Connection" description="How your AI agents connect to language models.">
              <SettingsCard>
                <SettingsRow
                  label="Connection type"
                  description={
                    authType === 'oauth_token' && hasCredential
                      ? 'Claude Pro/Max — using your Claude subscription'
                      : authType === 'api_key' && hasCredential
                        ? 'API Key — Anthropic, OpenRouter, or compatible API'
                        : 'Not configured'
                  }
                >
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openApiSetup}
                  >
                    Edit
                  </Button>
                </SettingsRow>
              </SettingsCard>
            </SettingsSection>

            {/* API Setup Fullscreen Overlay — reuses the OnboardingWizard starting at the api-setup step */}
            <FullscreenOverlayBase
              isOpen={showApiSetup}
              onClose={closeApiSetup}
              className="z-splash flex flex-col bg-foreground-2"
            >
              <OnboardingWizard
                state={apiSetupOnboarding.state}
                onContinue={apiSetupOnboarding.handleContinue}
                onBack={apiSetupOnboarding.handleBack}
                onSelectApiSetupMethod={apiSetupOnboarding.handleSelectApiSetupMethod}
                onSubmitCredential={apiSetupOnboarding.handleSubmitCredential}
                onStartOAuth={apiSetupOnboarding.handleStartOAuth}
                onFinish={handleApiSetupFinish}
                isWaitingForCode={apiSetupOnboarding.isWaitingForCode}
                onSubmitAuthCode={apiSetupOnboarding.handleSubmitAuthCode}
                onCancelOAuth={apiSetupOnboarding.handleCancelOAuth}
                className="h-full"
              />
              {/* Close button — rendered AFTER the wizard so it paints above its titlebar-drag-region */}
              <div
                className="fixed top-0 right-0 h-[50px] flex items-center pr-5 [-webkit-app-region:no-drag]"
                style={{ zIndex: 'var(--z-fullscreen, 350)' }}
              >
                <button
                  onClick={closeApiSetup}
                  className="p-1.5 rounded-[6px] transition-all bg-background shadow-minimal text-muted-foreground/50 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  title="Close (Esc)"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </FullscreenOverlayBase>

            {/* Web Remote Access */}
            <SettingsSection title="Web Remote Access" description="Access your sessions from any browser on the same network.">
              <SettingsCard>
                <SettingsRow
                  label="Status"
                  description={webBridgeInfo.running ? 'Server is running' : 'Server is not running'}
                >
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${webBridgeInfo.running ? 'bg-green-500/15 text-green-500' : 'bg-muted text-muted-foreground'}`}>
                    {webBridgeInfo.running ? 'Active' : 'Inactive'}
                  </span>
                </SettingsRow>
                {webBridgeInfo.running && webBridgeInfo.url && (
                  <SettingsRow label="URL">
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-muted px-2 py-1 rounded font-mono">{webBridgeInfo.url}</code>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => copyToClipboard(webBridgeInfo.url!, 'url')}
                      >
                        {copiedField === 'url' ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => window.electronAPI.openUrl(webBridgeInfo.url!)}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </SettingsRow>
                )}
                {webBridgeInfo.running && webBridgeInfo.token && (
                  <SettingsRow label="Auth Token">
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-muted px-2 py-1 rounded font-mono max-w-[200px] truncate">{webBridgeInfo.token}</code>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => copyToClipboard(webBridgeInfo.token!, 'token')}
                      >
                        {copiedField === 'token' ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </SettingsRow>
                )}
              </SettingsCard>
            </SettingsSection>

            {/* About */}
            <SettingsSection title="About">
              <SettingsCard>
                <SettingsRow label="Version">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {updateChecker.updateInfo?.currentVersion ?? 'Loading...'}
                    </span>
                    {/* Show downloading indicator when update is being downloaded */}
                    {updateChecker.isDownloading && updateChecker.updateInfo?.latestVersion && (
                      <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <Spinner className="w-3 h-3" />
                        <span>Downloading v{updateChecker.updateInfo.latestVersion} ({updateChecker.downloadProgress}%)</span>
                      </div>
                    )}
                  </div>
                </SettingsRow>
                <SettingsRow label="Check for updates">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCheckForUpdates}
                    disabled={isCheckingForUpdates}
                  >
                    {isCheckingForUpdates ? (
                      <>
                        <Spinner className="mr-1.5" />
                        Checking...
                      </>
                    ) : (
                      'Check Now'
                    )}
                  </Button>
                </SettingsRow>
                {updateChecker.isReadyToInstall && updateChecker.updateInfo?.latestVersion && (
                  <SettingsRow label="Update ready">
                    <Button
                      size="sm"
                      onClick={updateChecker.installUpdate}
                    >
                      Restart to Update to v{updateChecker.updateInfo.latestVersion}
                    </Button>
                  </SettingsRow>
                )}
              </SettingsCard>
            </SettingsSection>
          </div>
        </div>
        </ScrollArea>
      </div>
    </div>
  )
}
