import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Suspense, lazy, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './lib/auth'
import { queryClient } from './lib/queries'
import { ToastProvider } from './components/Toast'
import { Spinner } from './components/ui'
import AppShell from './components/AppShell'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'

// Route-level code splitting — keeps the initial bundle small; each page
// (and its heavy deps like Recharts or react-easy-crop) loads on navigation.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Clients = lazy(() => import('./pages/Clients'))
const BusinessProfile = lazy(() => import('./pages/BusinessProfile'))
const Intelligence = lazy(() => import('./pages/Intelligence'))
const IntelligenceReport = lazy(() => import('./pages/IntelligenceReport'))
const Trends = lazy(() => import('./pages/Trends'))
const Strategy = lazy(() => import('./pages/Strategy'))
const ContentFactory = lazy(() => import('./pages/ContentFactory'))
const CreativeReview = lazy(() => import('./pages/CreativeReview'))
const Calendar = lazy(() => import('./pages/Calendar'))
const Publishing = lazy(() => import('./pages/Publishing'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Settings = lazy(() => import('./pages/Settings'))
const Blog = lazy(() => import('./pages/Blog'))
const BlogPostEditor = lazy(() => import('./pages/BlogPostEditor'))

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
  return (
    <AppShell>
      <Suspense fallback={<div className="flex justify-center py-16"><Spinner size={24} /></div>}>{children}</Suspense>
    </AppShell>
  )
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <FullScreenLoader />
  if (session) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
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
              <Route path="/review" element={<Protected><CreativeReview /></Protected>} />
              <Route path="/calendar" element={<Protected><Calendar /></Protected>} />
              <Route path="/publishing" element={<Protected><Publishing /></Protected>} />
              <Route path="/blog" element={<Protected><Blog /></Protected>} />
              <Route path="/blog/new" element={<Protected><BlogPostEditor /></Protected>} />
              <Route path="/blog/:id" element={<Protected><BlogPostEditor /></Protected>} />
              <Route path="/analytics" element={<Protected><Analytics /></Protected>} />
              <Route path="/settings" element={<Protected><Settings /></Protected>} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
