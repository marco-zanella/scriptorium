import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { login as apiLogin, logout as apiLogout, me, refresh, type MeResponse } from './api'

type AuthStatus = 'checking' | 'authenticated' | 'anonymous'

interface AuthState {
  status: AuthStatus
  user: MeResponse | null
  login: (username: string, password: string, rememberMe: boolean) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking')
  const [user, setUser] = useState<MeResponse | null>(null)

  useEffect(() => {
    restoreSession()
  }, [])

  async function restoreSession() {
    try {
      setUser(await me())
      setStatus('authenticated')
      return
    } catch {
      // access token missing/expired — fall through to a refresh attempt
    }

    try {
      await refresh()
      setUser(await me())
      setStatus('authenticated')
    } catch {
      setStatus('anonymous')
    }
  }

  async function login(username: string, password: string, rememberMe: boolean) {
    await apiLogin(username, password, rememberMe)
    setUser(await me())
    setStatus('authenticated')
  }

  async function logout() {
    await apiLogout()
    setUser(null)
    setStatus('anonymous')
  }

  return (
    <AuthContext.Provider value={{ status, user, login, logout }}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
