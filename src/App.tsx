import { useEffect } from 'react'
import Layout from './components/layout/Layout'
import Home from './screens/Home'
import Entry from './screens/Entry'
import Cashflow from './screens/Cashflow'
import Review from './screens/Review'
import SettingsPage from './components/layout/Settings'
import { useAppStore } from './stores/appStore'

const VALID_PAGES = ['home', 'daily', 'cashflow', 'review', 'settings']

// 旧ページIDからの読み替え。LINE通知や古いブックマークからのリンクを死なせないため
const ALIAS: Record<string, string> = {
  dashboard: 'home',
  payments: 'cashflow',
  pl: 'review',
  analytics: 'review',
}

export default function App() {
  const { currentPage, setPage, setSelectedDate } = useAppStore()

  // LINEの通知から「その日の入力画面」を直接開けるようにする
  // 例：https://oneburg-finance.vercel.app/?page=daily&date=2026-08-06
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const date = params.get('date')
    const raw = params.get('page')
    const page = raw ? (ALIAS[raw] ?? raw) : null
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) setSelectedDate(date)
    if (page && VALID_PAGES.includes(page)) setPage(page)
    else if (date) setPage('daily')
    // クエリを消しておく（リロードや共有時に古い日付へ飛ばないように）
    if (date || raw) window.history.replaceState({}, '', window.location.pathname)
  }, [])

  const PAGE: Record<string, React.ReactNode> = {
    home:     <Home />,
    daily:    <Entry />,
    cashflow: <Cashflow />,
    review:   <Review />,
    settings: <SettingsPage />,
  }

  return (
    <Layout>
      {PAGE[currentPage] || <Home />}
    </Layout>
  )
}
