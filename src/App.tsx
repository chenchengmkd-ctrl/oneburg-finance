import { useEffect } from 'react'
import Layout from './components/layout/Layout'
import Dashboard from './components/dashboard/Dashboard'
import DailyEntry from './components/daily/DailyEntry'
import Payments from './components/payments/Payments'
import PL from './components/pl/PL'
import SettingsPage from './components/layout/Settings'
import { useAppStore } from './stores/appStore'

const VALID_PAGES = ['dashboard', 'daily', 'payments', 'pl', 'settings']

export default function App() {
  const { currentPage, setPage, setSelectedDate } = useAppStore()

  // LINEの通知から「その日の日次入力」を直接開けるようにする
  // 例：https://oneburg-finance.vercel.app/?page=daily&date=2026-08-06
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const date = params.get('date')
    const page = params.get('page')
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) setSelectedDate(date)
    if (page && VALID_PAGES.includes(page)) setPage(page)
    else if (date) setPage('daily')
    // クエリを消しておく（リロードや共有時に古い日付へ飛ばないように）
    if (date || page) window.history.replaceState({}, '', window.location.pathname)
  }, [])

  const PAGE: Record<string, React.ReactNode> = {
    dashboard: <Dashboard />,
    daily:     <DailyEntry />,
    payments:  <Payments />,
    pl:        <PL />,
    settings:  <SettingsPage />,
  }

  return (
    <Layout>
      {PAGE[currentPage] || <Dashboard />}
    </Layout>
  )
}
