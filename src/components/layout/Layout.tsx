import { useAppStore } from '../../stores/appStore'
import { LayoutDashboard, NotebookPen, ClipboardList, Landmark, BarChart3, Settings } from 'lucide-react'

const NAV = [
  { id: 'dashboard', label: 'ダッシュボード', icon: LayoutDashboard },
  { id: 'daily',     label: '日次入力',       icon: NotebookPen },
  { id: 'pl',        label: '損益表',         icon: BarChart3 },
  { id: 'report',    label: '残高報告',       icon: ClipboardList },
  { id: 'payments',  label: '資金繰り',       icon: Landmark },
  { id: 'settings',  label: '設定',           icon: Settings },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const { currentPage, setPage } = useAppStore()
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* サイドバー */}
      <aside className="w-56 bg-blue-950 flex flex-col shrink-0">
        <div className="px-4 py-5 border-b border-blue-900">
          <div className="text-blue-300 font-black text-lg tracking-tight">株式会社ワンバーグ</div>
          <div className="text-blue-400 text-xs mt-0.5">財務管理</div>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={`nav-link w-full text-left ${currentPage === id ? 'active' : ''}`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      {/* メインコンテンツ */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
