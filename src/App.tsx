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
import AccountPending, { type AccountBlockReason } from './pages/AccountPending'
import NoAccess from './pages/NoAccess'
import type { FeatureKey } from './lib/permissions'

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
const CarouselStudio = lazy(() => import('./pages/CarouselStudio'))
const VideoStudio = lazy(() => import('./pages/VideoStudio'))
const AIStudio = lazy(() => import('./pages/AIStudio'))
const CreativeReview = lazy(() => import('./pages/CreativeReview'))
const Calendar = lazy(() => import('./pages/Calendar'))
const Publishing = lazy(() => import('./pages/Publishing'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Settings = lazy(() => import('./pages/Settings'))
const Blog = lazy(() => import('./pages/Blog'))
const BlogPostEditor = lazy(() => import('./pages/BlogPostEditor'))
const UserManual = lazy(() => import('./pages/UserManual'))
const TeamAccess = lazy(() => import('./pages/TeamAccess'))
const Board = lazy(() => import('./pages/Board'))

function FullScreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Spinner size={28} />
    </div>
  )
}

function Protected({ children, feature }: { children: ReactNode; feature?: FeatureKey }) {
  const { session, loading, appUser, appUserLoading, appUserError, can, permissionsLoading } = useAuth()
  const location = useLocation()
  if (loading) return <FullScreenLoader />
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />

  // Authenticated is not the same as authorised. Signing in with Google only proves the address
  // is real and on the @scalepods.co domain (enforced by a trigger on auth.users); an admin
  // still has to switch the account on. Anything short of an active team record stops here.
  //
  // The failure case denies rather than allows: if the directory lookup errors we show a retry
  // wall instead of falling through, because guessing "probably fine" on an access check is how
  // an outage turns into an open door.
  // Waits for permissions too, not just the directory row. Without this the sidebar renders its
  // ungated items first (manual, support) and the rest pop in a beat later — which reads as the
  // app briefly deciding you have no access. One spinner is better than a flicker.
  if (appUserLoading || permissionsLoading) return <FullScreenLoader />
  const block: AccountBlockReason | null = appUserError
    ? 'lookup-failed'
    : !appUser
      ? 'no-record'
      : appUser.status !== 'active'
        ? (appUser.status as AccountBlockReason)
        : null
  if (block) return <AccountPending reason={block} />

  // Hiding the nav item is cosmetic; this is what stops someone typing the path in. Rendered as
  // an explanation rather than a redirect, because silently bouncing somebody to the dashboard
  // reads like a broken link when it is actually a deliberate permission boundary.
  if (feature && !can(feature, 'view')) {
    return (
      <AppShell>
        <NoAccess feature={feature} />
      </AppShell>
    )
  }

  return (
    <AppShell>
      <Suspense fallback={<div className="flex justify-center py-16"><Spinner size={24} /></div>}>{children}</Suspense>
    </AppShell>
  )
}

/** Wraps a route that only an owner/admin may open. Mirrors app_is_admin() in Postgres, which
 *  is what actually protects the underlying tables — this just avoids rendering a screen that
 *  would come back empty. */
function AdminOnly({ children }: { children: ReactNode }) {
  const { appUser } = useAuth()
  if (appUser?.role !== 'owner' && appUser?.role !== 'admin') return <Navigate to="/settings" replace />
  return <>{children}</>
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
              <Route path="/clients" element={<Protected feature="business"><Clients /></Protected>} />
              <Route path="/clients/new" element={<Protected feature="business"><BusinessProfile /></Protected>} />
              <Route path="/clients/:id" element={<Protected feature="business"><BusinessProfile /></Protected>} />
              <Route path="/intelligence" element={<Protected feature="intelligence"><Intelligence /></Protected>} />
              <Route path="/intelligence/:id" element={<Protected feature="intelligence"><IntelligenceReport /></Protected>} />
              <Route path="/trends" element={<Protected feature="trends"><Trends /></Protected>} />
              <Route path="/strategy" element={<Protected feature="strategy"><Strategy /></Protected>} />
              <Route path="/content" element={<Protected feature="content"><ContentFactory /></Protected>} />
              <Route path="/carousel-studio" element={<Protected feature="carousel_studio"><CarouselStudio /></Protected>} />
              <Route path="/video-studio" element={<Protected feature="video_studio"><VideoStudio /></Protected>} />
              <Route path="/studio" element={<Protected feature="studio"><AIStudio /></Protected>} />
              <Route path="/review" element={<Protected feature="review"><CreativeReview /></Protected>} />
              {/* /board/:key deep-links a single ticket — the same board with its drawer open,
                  so a ticket can be pasted into chat and land somewhere useful. */}
              <Route path="/board" element={<Protected feature="board"><Board /></Protected>} />
              <Route path="/board/:key" element={<Protected feature="board"><Board /></Protected>} />
              <Route path="/calendar" element={<Protected feature="calendar"><Calendar /></Protected>} />
              <Route path="/publishing" element={<Protected feature="publishing"><Publishing /></Protected>} />
              <Route path="/blog" element={<Protected feature="blog"><Blog /></Protected>} />
              <Route path="/blog/new" element={<Protected feature="blog"><BlogPostEditor /></Protected>} />
              <Route path="/blog/:id" element={<Protected feature="blog"><BlogPostEditor /></Protected>} />
              <Route path="/analytics" element={<Protected feature="analytics"><Analytics /></Protected>} />
              <Route path="/settings" element={<Protected feature="settings"><Settings /></Protected>} />
              {/* Admin-only, guarded by <AdminOnly> rather than by permissions: managing people
                  follows from the role, not from a feature grant. See permissions.ts. */}
              <Route path="/settings/team" element={<Protected feature="settings"><AdminOnly><TeamAccess /></AdminOnly></Protected>} />
              <Route path="/manual" element={<Protected><UserManual /></Protected>} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
