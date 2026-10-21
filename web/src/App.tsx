import { lazy } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { EmptyState, ErrorState, PageTitle } from './components/ui'
import WorklistPage from './pages/WorklistPage'
import { useApp } from './state/app'

// The worklist is the landing page and stays in the entry chunk; every other route loads on demand.
const PatientPage = lazy(() => import('./pages/PatientPage'))
const LivePage = lazy(() => import('./pages/LivePage'))
const EvidencePage = lazy(() => import('./pages/EvidencePage'))
const AboutPage = lazy(() => import('./pages/AboutPage'))

function NotFound() {
  return (
    <div>
      <PageTitle title="Page not found" />
      <EmptyState title="There is nothing at this address">
        Go back to the <Link to="/">worklist</Link>.
      </EmptyState>
    </div>
  )
}

/** Blocks clock-dependent pages until /api/meta says what the demo clock range is. */
function MetaGate({ children }: { children: React.ReactNode }) {
  const { meta, metaError, reloadMeta } = useApp()
  if (!meta && metaError) {
    return <ErrorState error={metaError} onRetry={reloadMeta} title="Cannot reach the Pratirup server" />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route
          index
          element={
            <MetaGate>
              <WorklistPage />
            </MetaGate>
          }
        />
        <Route
          path="patients/:rid"
          element={
            <MetaGate>
              <PatientPage />
            </MetaGate>
          }
        />
        <Route path="live" element={<LivePage />} />
        <Route path="evidence" element={<EvidencePage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
