import { useEffect } from 'react'

export function useAppBadge(active: boolean) {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const navigatorWithBadging = window.navigator as Navigator & {
      clearAppBadge?: () => Promise<void>
      setAppBadge?: (contents?: number) => Promise<void>
    }
    const clearBadge = navigatorWithBadging.clearAppBadge?.bind(navigatorWithBadging)
    const setBadge = navigatorWithBadging.setAppBadge?.bind(navigatorWithBadging)

    if (!setBadge && !clearBadge) {
      return undefined
    }

    if (active) {
      void setBadge?.(1).catch(() => undefined)
    } else {
      void clearBadge?.().catch(() => undefined)
    }

    return () => {
      void clearBadge?.().catch(() => undefined)
    }
  }, [active])
}
