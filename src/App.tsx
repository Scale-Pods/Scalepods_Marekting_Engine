import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './lib/auth'
import { Spinner } from './components/ui'
import AppShell from './components/AppShell'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import Clients from './pages/Clients'
import BusinessProfile from './pages/BusinessProfile'
import Intelligence from './pages/Intelligence'
import IntelligenceReport from './pages/IntelligenceReport'
import Trends from './pages/Trends'
import Strategy from './pages/Strategy'
import ContentFactory from './pages/ContentFactory'
import Placeholder from './pages/Placeholder'

function FullScreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Spinner size={28} />
    </div>
  )
}

function Protected({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullScreenLoader />
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />
  return <AppShell>{children}</AppShell>
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <FullScreenLoader />
  if (session) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route path="/" element={<Protected><Dashboard /></Protected>} />
          <Route path="/clients" element={<Protected><Clients /></Protected>} />
          <Route path="/clients/new" element={<Protected><BusinessProfile /></Protected>} />
          <Route path="/clients/:id" element={<Protected><BusinessProfile /></Protected>} />
          <Route path="/intelligence" element={<Protected><Intelligence /></Protected>} />
          <Route path="/intelligence/:id" element={<Protected><IntelligenceReport /></Protected>} />
          <Route path="/trends" element={<Protected><Trends /></Protected>} />
          <Route path="/strategy" element={<Protected><Strategy /></Protected>} />
          <Route path="/content" element={<Protected><ContentFactory /></Protected>} />
          <Route path="/review" element={<Protected><Placeholder title="Creative Review" step="Step 6" /></Protected>} />
          <Route path="/calendar" element={<Protected><Placeholder title="Calendar" step="Step 5" /></Protected>} />
          <Route path="/publishing" element={<Protected><Placeholder title="Publishing" step="Step 7" /></Protected>} />
          <Route path="/analytics" element={<Protected><Placeholder title="Analytics" step="Step 8" /></Protected>} />
          <Route path="/settings" element={<Protected><Placeholder title="Settings" step="Step 9" /></Protected>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
