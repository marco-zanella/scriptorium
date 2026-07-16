import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'

type Theme = 'dark' | 'light'

interface ThemeProviderProps {
  children: ReactNode
  storageKey?: string
}

interface ThemeProviderState {
  theme: Theme
  toggleTheme: () => void
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined)

function getInitialTheme(storageKey: string): Theme {
  const stored = localStorage.getItem(storageKey)
  if (stored === 'light' || stored === 'dark') {
    return stored
  }
  // No explicit choice yet — use the OS preference once as a starting point,
  // but from here on this is a plain light/dark toggle, not a live "system" mode.
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children, storageKey = 'scriptorium-theme' }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme(storageKey))

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(theme)
  }, [theme])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem(storageKey, next)
    setTheme(next)
  }

  return (
    <ThemeProviderContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeProviderContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
