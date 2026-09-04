import CashflowCalendar from '../components/cashflow/CashflowCalendar'

// 資金繰り：この先いくら入って・出て、残高がどうなるかを見る画面。
// 中身は資金繰りカレンダー（週間／月間グリッド＋残高記録）だけ。
// 以前ここにあった「資金繰り予定一覧（固定・変動・突発）」と「借入・立替金」は、
// 実データが一度も保存されておらず（初期値が表示されていただけ）、グリッドと二重管理になっていたため廃止した（2026-09）
export default function Cashflow() {
  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">資金繰り</h1>
      <p className="text-gray-400 text-sm mb-5">
        週の初めに予定を入れて、いつ資金が足りなくなるかを先に見ておく。残高もここで記録する
      </p>
      <CashflowCalendar />
    </div>
  )
}
