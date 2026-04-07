import { useEffect, useState } from 'react'

interface DeferredInstallPromptChoice {
  outcome: 'accepted' | 'dismissed'
  platform: string
}

export interface DeferredInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<DeferredInstallPromptChoice>
}

interface InstallPromptState {
  canInstall: boolean
  installApp: () => Promise<void>
}

export function useInstallPrompt(): InstallPromptState {
  const [deferredPrompt, setDeferredPrompt] = useState<DeferredInstallPromptEvent | null>(null)
  const [isStandalone, setIsStandalone] = useState(readStandaloneDisplayMode)

  useEffect(() => {
    const mediaQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(display-mode: standalone)') : null

    const syncStandaloneMode = () => {
      setIsStandalone(readStandaloneDisplayMode())
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      const promptEvent = event as DeferredInstallPromptEvent
      promptEvent.preventDefault()
      setDeferredPrompt(promptEvent)
      syncStandaloneMode()
    }

    const handleInstalled = () => {
      setDeferredPrompt(null)
      setIsStandalone(true)
    }

    syncStandaloneMode()
    if (mediaQuery?.addEventListener) {
      mediaQuery.addEventListener('change', syncStandaloneMode)
    } else {
      mediaQuery?.addListener?.(syncStandaloneMode)
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)

    return () => {
      if (mediaQuery?.removeEventListener) {
        mediaQuery.removeEventListener('change', syncStandaloneMode)
      } else {
        mediaQuery?.removeListener?.(syncStandaloneMode)
      }
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  async function installApp() {
    if (!deferredPrompt || isStandalone) {
      return
    }

    try {
      await deferredPrompt.prompt()
      await deferredPrompt.userChoice
    } catch {
      // Ignore prompt failures and wait for the next eligible event.
    } finally {
      setDeferredPrompt(null)
      setIsStandalone(readStandaloneDisplayMode())
    }
  }

  return {
    canInstall: deferredPrompt !== null && !isStandalone,
    installApp,
  }
}

function readStandaloneDisplayMode() {
  if (typeof window === 'undefined') {
    return false
  }

  const mediaMatches = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
  const navigatorLike = window.navigator as Navigator & { standalone?: boolean }

  return mediaMatches || navigatorLike.standalone === true
}
