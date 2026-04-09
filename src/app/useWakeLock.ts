import { useEffect } from 'react'

interface WakeLockSentinelLike {
  released: boolean
  release: () => Promise<void>
}

export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof document === 'undefined') {
      return undefined
    }

    const navigatorWithWakeLock = window.navigator as Navigator & {
      wakeLock?: {
        request: (type: 'screen') => Promise<WakeLockSentinelLike>
      }
    }
    const wakeLockController = navigatorWithWakeLock.wakeLock
    if (typeof wakeLockController?.request !== 'function') {
      return undefined
    }

    let wakeLock: WakeLockSentinelLike | null = null
    let cancelled = false

    const requestWakeLock = async () => {
      if (document.visibilityState !== 'visible' || cancelled) {
        return
      }

      try {
        wakeLock = await wakeLockController.request('screen')
      } catch {
        wakeLock = null
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && (wakeLock === null || wakeLock.released)) {
        void requestWakeLock()
      }
    }

    void requestWakeLock()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (wakeLock && !wakeLock.released) {
        void wakeLock.release().catch(() => undefined)
      }
    }
  }, [active])
}
