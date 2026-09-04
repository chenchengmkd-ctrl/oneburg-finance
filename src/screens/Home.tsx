import { useEffect, useMemo } from 'react'
import { useAppStore } from '../stores/appStore'
import { fmt, fmtShort, todayStr } from '../utils/calculations'
import { buildCfGrid, latestBalanceOn, dateRange } from '../utils/cashflowCalc'
import { calcPL } from '../utils/plCalc'
import { calcBudget, isBehindPace } from '../utils/budgetCalc'
import { sumNet, sumShiftPay, toNet, salesTaxRateOf } from '../utils/storage'
import { Wallet, AlertTriangle, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react'

// ホーム：「今いくらあるか」「今月儲かっているか」「今日どうだったか」の3つだけに絞った画面。
// 手元資金は資金繰り画面で記録した実額を起点に計算する（日次入力の積み上げでは実残高が出せないため）

const AHEAD_DAYS = 30   // 資金ショートを何日先まで見るか

export default function Home() {
  const {
    reports, cfPlan, cashflowRecords, salesDetails, budget,
    loadReports, loadCfPlan, loadCashflowRecords, loadSalesDetails, loadBudget,
    setPage, setSelectedDate,
  } = useAppStore()

  useEffect(() => {
    loadReports(); loadCfPlan(); loadCashflowRecords(); loadSalesDetails(); loadBudget()
  }, [])

  const today = todayStr()
  // ホームは「今」を見る画面なので、設定の対象月ではなく常に今月を出す
  // （過去の月を振り返るのは「ふりかえり」画面の役目）
  const month = today.slice(0, 7)

  // ---- 手元資金と、この先の資金ショート ----
  const startBalance = useMemo(() => latestBalanceOn(cfPlan, today), [cfPlan, today])
  const grid = useMemo(() => {
    if (!startBalance) return null
    const end = new Date(today)
    end.setDate(end.getDate() + AHEAD_DAYS)
    const endIso = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
    return buildCfGrid(dateRange(startBalance.date, endIso), cashflowRecords, cfPlan, reports, today)
  }, [startBalance, cashflowRecords, cfPlan, reports, today])

  const cashOnHand = grid ? grid.balance[today] : null
  // 今日より先で残高がマイナスに落ちる最初の日
  const shortDate = useMemo(() => {
    if (!grid) return null
    return grid.dates.find(d => d > today && grid.balance[d] < 0) ?? null
  }, [grid, today])

  // ---- 今月 ----
  const pl = useMemo(() => calcPL(reports, month), [reports, month])
  const bg = useMemo(() => calcBudget(reports, budget, month, today), [reports, budget, month, today])
  const monthProfitable = pl.profitNet >= 0
  const perDay = pl.daysWithData > 0 ? Math.round(pl.revenueNet / pl.daysWithData) : 0

  // ---- 今日 ----
  const todayReport = reports[today]
  const todaySales = todayReport ? todayReport.cash.sales : 0
  const todaySalesNet = todayReport ? toNet(todaySales, salesTaxRateOf(todayReport.cash)) : 0
  const todayLabor = todayReport ? sumShiftPay(todayReport.shifts) : 0
  const todayExpense = todayReport ? sumNet(todayReport.corp.withdraws.filter(w => w.category !== 'labor')) : 0
  const todayProfit = todaySalesNet - todayLabor - todayExpense
  const customers = salesDetails[today]?.customers ?? 0

  const openEntry = () => { setSelectedDate(today); setPage('daily') }

  return (
    <div className="p-4 sm:p-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">ホーム</h1>
      <p className="text-gray-400 text-sm mb-5">{today.replace(/-/g, '/')} 時点</p>

      {/* 1. 今いくらあるか */}
      {cashOnHand !== null && startBalance ? (
        <div className={`card border-l-4 mb-4 ${cashOnHand < 0 ? 'border-red-500' : 'border-teal-500'}`}>
          <div className="card-header flex items-center gap-1"><Wallet size={12}/> 手元資金</div>
          <div className={`text-4xl font-black ${cashOnHand < 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmt(cashOnHand)}</div>
          <div className="text-xs text-gray-400 mt-1">
            {startBalance.date.slice(5).replace('-', '/')}に記録した実額 {fmt(startBalance.amount)} から、その後の収支を足し引きした概算
          </div>
          {shortDate && (
            <button onClick={() => setPage('cashflow')}
              className="mt-3 w-full flex items-center gap-2 text-left bg-red-50 text-red-700 rounded-lg px-3 py-2 hover:bg-red-100 transition">
              <AlertTriangle size={16} className="shrink-0"/>
              <span className="text-sm font-bold flex-1">
                {shortDate.slice(5).replace('-', '/')}に {fmt(grid!.balance[shortDate])} まで下がる見込み
              </span>
              <ArrowRight size={14} className="shrink-0"/>
            </button>
          )}
        </div>
      ) : (
        <button onClick={() => setPage('cashflow')}
          className="card w-full text-left border-l-4 border-gray-300 mb-4 hover:bg-gray-50 transition">
          <div className="card-header flex items-center gap-1"><Wallet size={12}/> 手元資金</div>
          <div className="text-sm text-gray-500">
            まだ残高が記録されていません。資金繰り画面で、通帳やアプリで見た実際の残高を1度記録してください →
          </div>
        </button>
      )}

      {/* 2. 今月儲かっているか */}
      <div className={`card border-l-4 mb-4 ${monthProfitable ? 'border-green-500' : 'border-red-500'}`}>
        <div className="card-header flex items-center justify-between">
          <span className="flex items-center gap-1">
            {monthProfitable ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}
            {Number(month.slice(5))}月の利益
          </span>
          <span className="text-[10px] font-normal text-gray-400">税抜・{pl.daysWithData}日分</span>
        </div>
        <div className={`text-3xl font-black ${monthProfitable ? 'text-green-600' : 'text-red-600'}`}>
          {monthProfitable ? '+' : ''}{fmt(pl.profitNet)}
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-3 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">売上</span><span className="font-bold text-blue-700">{fmt(pl.revenueNet)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">経費</span><span className="font-bold text-orange-700">-{fmt(pl.expenseNet)}</span></div>
          <div className="flex justify-between"><span className="text-gray-400 text-xs">1日平均の売上</span><span className="text-xs text-gray-500">{fmtShort(perDay)}</span></div>
          {bg.hasBudget && bg.revenueBudget > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-400 text-xs">売上の目標達成</span>
              <span className={`text-xs font-bold ${isBehindPace(bg.revenueRate, bg.paceRate) ? 'text-red-500' : 'text-gray-500'}`}>
                {Math.round((bg.revenueRate ?? 0) * 100)}%（日数 {Math.round(bg.paceRate * 100)}%経過）
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 3. 今日 */}
      <button onClick={openEntry} className="card w-full text-left hover:bg-gray-50 transition mb-4">
        <div className="card-header flex items-center justify-between">
          <span>今日</span>
          <span className="text-[11px] font-normal text-blue-600 flex items-center gap-0.5">経費を入力する <ArrowRight size={12}/></span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <div className="text-[11px] text-gray-400">売上（税込）</div>
            <div className="text-2xl font-black text-blue-700">{fmt(todaySales)}</div>
          </div>
          <div>
            <div className="text-[11px] text-gray-400">客数</div>
            <div className="text-lg font-bold text-gray-600">{customers > 0 ? `${customers}組` : '—'}</div>
          </div>
          <div>
            <div className="text-[11px] text-gray-400">人件費</div>
            <div className="text-lg font-bold text-purple-700">{fmt(todayLabor)}</div>
          </div>
          <div>
            <div className="text-[11px] text-gray-400">経費</div>
            <div className="text-lg font-bold text-orange-700">{todayExpense > 0 ? fmt(todayExpense) : '未入力'}</div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-[11px] text-gray-400">今日の利益（税抜）</div>
            <div className={`text-2xl font-black ${todayProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {todayProfit >= 0 ? '+' : ''}{fmt(todayProfit)}
            </div>
          </div>
        </div>
      </button>
    </div>
  )
}
