import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api } from '../api/client.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const data = await api.get('/me')
    setUser(data.user)
  }, [])

  useEffect(() => {
    refresh()
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [refresh])

  const login = async (email, password) => {
    const loggedInUser = await api.post('/login', { email, password })
    setUser(loggedInUser)
    return loggedInUser
  }

  const signup = async (payload) => {
    const newUser = await api.post('/signup', payload)
    setUser(newUser)
    return newUser
  }

  const logout = async () => {
    await api.post('/logout', {})
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
