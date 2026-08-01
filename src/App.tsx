import Layout from './components/layout/Layout'
import Dashboard from './components/dashboard/Dashboard'
import DailyEntry from './components/daily/DailyEntry'
import Report from './components/report/Report'
import Payments from './components/payments/Payments'
import PL from './components/pl/PL'
import SettingsPage from './components/layout/Settings'
import { useAppStore } from './stores/appStore'

export default function App() {
  const { currentPage } = useAppStore()

  const PAGE: Record<string, React.ReactNode> = {
    dashboard: <Dashboard />,
    daily:     <DailyEntry />,
    report:    <Report />,
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
