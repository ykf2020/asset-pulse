import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/app/auth'
import { queryClient } from '@/app/queryClient'
import { TabBar } from '@/components/TabBar'
import { LoadingBlock } from '@/components/ui/Feedback'
import { useCacheHydration } from '@/hooks/useData'
import { AccountEdit } from '@/routes/AccountEdit'
import { Accounts } from '@/routes/Accounts'
import { Dashboard } from '@/routes/Dashboard'
import { History } from '@/routes/History'
import { Review } from '@/routes/Review'
import { ReviewDetail } from '@/routes/ReviewDetail'
import { Settings } from '@/routes/Settings'
import { Unlock } from '@/routes/Unlock'

/** 盤點流程是全螢幕的，不顯示底部 Tab */
const FULLSCREEN_PATHS = ['/review']

function Shell() {
  const { unlocked } = useAuth()
  const hydrated = useCacheHydration(unlocked)
  const { pathname } = useLocation()

  if (!unlocked) return <Unlock />
  if (!hydrated) return <LoadingBlock />

  const fullscreen = FULLSCREEN_PATHS.some((p) => pathname.startsWith(p))

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg safe-x">
      <div className={fullscreen ? '' : 'safe-top pb-20'}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/accounts/new" element={<AccountEdit />} />
          <Route path="/accounts/:id" element={<AccountEdit />} />
          <Route path="/review" element={<Review />} />
          <Route path="/history" element={<History />} />
          <Route path="/history/:id" element={<ReviewDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </div>
      {!fullscreen && <TabBar />}
    </div>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
