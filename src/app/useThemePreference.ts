import { useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = Exclude<ThemePreference, 'system'>

const themePreferenceStorageKey = 'payclock:ui:theme:v1'
const systemThemeMediaQuery = '(prefers-color-scheme: dark)'
const themeColorByMode: Record<ResolvedTheme, string> = {
  light: '#efe4d3',
  dark: '#122431',
}

export function useThemePreference() {
  const [themePreference, setThemePreference] = useState<ThemePreference>(readStoredThemePreference)
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(readSystemTheme)
  const resolvedTheme = themePreference === 'system' ? systemTheme : themePreference

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined
    }

    const mediaQuery = window.matchMedia(systemThemeMediaQuery)
    const updateSystemTheme = () => {
      setSystemTheme(mediaQuery.matches ? 'dark' : 'light')
    }

    updateSystemTheme()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateSystemTheme)
      return () => {
        mediaQuery.removeEventListener('change', updateSystemTheme)
      }
    }

    mediaQuery.addListener(updateSystemTheme)
    return () => {
      mediaQuery.removeListener(updateSystemTheme)
    }
  }, [])

  useEffect(() => {
    const storage = resolveThemeStorage()
    if (storage === null) {
      return
    }

    storage.setItem(themePreferenceStorageKey, themePreference)
  }, [themePreference])

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined
    }

    const root = document.documentElement
    const previousTheme = root.dataset.theme
    const previousColorScheme = root.style.colorScheme
    const themeColorMeta = ensureThemeColorMeta()
    const previousThemeColor = themeColorMeta?.getAttribute('content') ?? null

    root.dataset.theme = resolvedTheme
    root.style.colorScheme = resolvedTheme
    themeColorMeta?.setAttribute('content', themeColorByMode[resolvedTheme])

    return () => {
      if (previousTheme) {
        root.dataset.theme = previousTheme
      } else {
        delete root.dataset.theme
      }
      root.style.colorScheme = previousColorScheme
      if (previousThemeColor !== null) {
        themeColorMeta?.setAttribute('content', previousThemeColor)
      }
    }
  }, [resolvedTheme])

  return {
    themePreference,
    resolvedTheme,
    setThemePreference,
  }
}

function readStoredThemePreference(): ThemePreference {
  const storage = resolveThemeStorage()
  if (storage === null) {
    return 'system'
  }

  const storedValue = storage.getItem(themePreferenceStorageKey)
  if (storedValue === 'light' || storedValue === 'dark' || storedValue === 'system') {
    return storedValue
  }

  return 'system'
}

function readSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light'
  }

  return window.matchMedia(systemThemeMediaQuery).matches ? 'dark' : 'light'
}

function resolveThemeStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof window === 'undefined') {
    return null
  }

  const storageCandidate = window.localStorage
  if (
    typeof storageCandidate === 'object' &&
    storageCandidate !== null &&
    typeof storageCandidate.getItem === 'function' &&
    typeof storageCandidate.setItem === 'function'
  ) {
    return storageCandidate
  }

  return null
}

function ensureThemeColorMeta(): HTMLMetaElement | null {
  if (typeof document === 'undefined') {
    return null
  }

  const existing = document.querySelector('meta[name="theme-color"]')
  if (existing instanceof HTMLMetaElement) {
    return existing
  }

  const created = document.createElement('meta')
  created.name = 'theme-color'
  document.head.appendChild(created)
  return created
}
