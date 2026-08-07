import { useAppStore } from '../../stores/appStore'
import { LayoutDashboard, NotebookPen, Landmark, BarChart3, Settings } from 'lucide-react'

// 残高報告タブは廃止（2026-08-06）。日次入力に一本化した。
// データ構造（BalanceReport）はそのまま使い続けているので、過去の入力も損益表・ダッシュボードに反映される。
const NAV = [
  { id: 'dashboard', label: 'ダッシュボード', icon: LayoutDashboard },
  { id: 'daily',     label: '日次入力',       icon: NotebookPen },
  { id: 'pl',        label: '損益表',         icon: BarChart3 },
  { id: 'payments',  label: '資金繰り',       icon: Landmark },
  { id: 'settings',  label: '設定',           icon: Settings },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const { currentPage, setPage } = useAppStore()
  return (
    <div className="flex flex-col sm:flex-row h-screen overflow-hidden bg-gray-50">
      {/* サイドバー（sm以上） */}
      <aside className="hidden sm:flex w-56 bg-blue-950 flex-col shrink-0">
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

      {/* モバイル用ヘッダー */}
      <div className="sm:hidden shrink-0 bg-blue-950 px-4 py-3 flex items-baseline gap-2">
        <span className="text-blue-300 font-black text-base tracking-tight">株式会社ワンバーグ</span>
        <span className="text-blue-400 text-xs">財務管理</span>
      </div>

      {/* メインコンテンツ */}
      <main className="flex-1 overflow-auto pb-16 sm:pb-0">
        {children}
      </main>

      {/* モバイル用ボトムナビ */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-blue-950 flex justify-around items-stretch shrink-0 z-10 pb-[env(safe-area-inset-bottom)]">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setPage(id)}
            className={`flex flex-col items-center gap-0.5 py-2 px-1 flex-1 text-[10px] transition ${
              currentPage === id ? 'text-blue-300' : 'text-blue-500'
            }`}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
