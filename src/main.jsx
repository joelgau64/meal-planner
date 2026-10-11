import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// ── Jeton d'accès aux routes /api ────────────────────────────────────────────
// Ajoute x-app-token à tous les appels same-origin vers /api/. Si le serveur répond 401
// (APP_TOKEN défini sur Vercel et jeton absent/faux), on le demande une fois puis on rejoue.
const TOKEN_KEY = 'app_token'
const nativeFetch = window.fetch.bind(window)
let asking = null
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url
  if (!url.startsWith('/api/')) return nativeFetch(input, init)
  const withToken = () => {
    const headers = new Headers(init.headers || {})
    const t = localStorage.getItem(TOKEN_KEY)
    if (t) headers.set('x-app-token', t)
    return nativeFetch(input, { ...init, headers })
  }
  const res = await withToken()
  if (res.status !== 401) return res
  asking = asking || Promise.resolve(window.prompt("Code d'accès Meal Planner :")).finally(() => { setTimeout(() => { asking = null }, 0) })
  const t = await asking
  if (!t) return res
  localStorage.setItem(TOKEN_KEY, t.trim())
  return withToken()
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
)
