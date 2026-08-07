import { useEffect, useMemo } from 'react'
import { useAppStore } from '../../stores/appStore'
import { fmt, fmtShort } from '../../utils/calculations'
import { buildReportSeries, projectReal, tomorrowStr } from '../../utils/reportCalc'
import { upcomingPayments, netCashflow } from '../../utils/paymentCalc'
import { calcBudget, isOverPace, isBehindPace } from '../../utils/budgetCalc'
import { Building2, User, Wallet, Coins, TrendingUp, TrendingDown, CalendarClock, Landmark } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const AmountCard = ({ label, amount, sub, color, icon: Icon }: {
  label: string; amount: number; sub?: string; color: string; icon: React.ElementType
}) => (
  <div className={`card border-l-4 ${color}`}>
    <div className="flex items-start justify-between">
      <div>
        <div className="card-header">{label}</div>
        <div className="text-2xl font-bold">{fmt(amount)}</div>
        {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
      </div>
      <Icon size={20} className="text-gray-300 mt-1" />
    </div>
  </div>
)

// 予実の進捗バー。実績バーの上に「今日時点であるべきペース」の線を出す
function BudgetBar({ label, actual, plan, rate, paceRate, color, behindIsBad }: {
  label: string; actual: number; plan: number
  rate: number | null; paceRate: number; color: string; behindIsBad?: boolean
}) {
  if (plan <= 0) return null
  const pctVal = Math.round((rate ?? 0) * 100)
  const bad = behindIsBad ? isBehindPace(rate, paceRate) : isOverPace(rate, paceRate)
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="flex items-baseline gap-2">
          <span className={`text-[11px] ${bad ? 'text-red-500 font-bold' : 'text-gray-400'}`}>{pctVal}%</span>
          <span className="font-bold text-gray-700">{fmtShort(actual)}</span>
          <span className="text-[11px] text-gray-400">／ {fmtShort(plan)}</span>
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded overflow-hidden relative">
        <div className={`h-full ${color} rounded`} style={{ width: `${Math.min(100, pctVal)}%` }}/>
        {paceRate > 0 && paceRate < 1 && (
          <div className="absolute top-0 h-full w-px bg-gray-600/70" style={{ left: `${paceRate * 100}%` }}/>
        )}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { settings, reports, loans, payments, budget, loadSettings, loadReports, loadLoans, loadPayments, loadBudget, setPage } = useAppStore()
  const today = new Date()
  const month = settings.targetMonth || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  useEffect(() => {
    loadSettings()
    loadReports()
    loadLoans()
    loadPayments()
    loadBudget()
  }, [])

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const bg = useMemo(() => calcBudget(reports, budget, month, todayStr), [reports, budget, month, todayStr])

  const series = useMemo(() => buildReportSeries(reports), [reports])
  const monthSeries = series.filter(s => s.date.startsWith(month))
  const latest = monthSeries[monthSeries.length - 1]
  const monthBase = monthSeries[0]
  const monthPL = latest && monthBase ? latest.realBal - monthBase.realBal : null
  const tomorrowProj = latest ? projectReal(monthSeries, tomorrowStr(latest.date)) : null

  const chartData = monthSeries.map(s => ({
    day: s.date.slice(5).replace('-', '/'),
    残高合計: s.totalBal,
    実質総資産: s.realBal,
  }))

  // 今後7日の資金繰り
  const upcoming7 = useMemo(() => upcomingPayments(payments, todayStr, 7), [payments, todayStr])
  const cf7 = netCashflow(upcoming7)
  const overdueCount = upcoming7.filter(it => it.overdue).length
  const short7 = cf7.net < 0

  // 借入・立替金の残高
  const totalLoanRemaining = loans.reduce((s, l) => s + Math.max(0, l.totalAmount - l.paidAmount), 0)

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">ダッシュボード</h1>
        <p className="text-gray-400 text-sm mt-1">{month.replace('-', '年')}月 / {todayStr} 時点</p>
      </div>

      {!latest ? (
        <div className="card text-center py-12">
          <p className="text-gray-500 mb-3">まだ残高報告が入力されていません</p>
          <button onClick={() => setPage('report')}
            className="bg-blue-700 text-white px-5 py-2 rounded-lg font-bold hover:bg-blue-800 transition">
            残高報告を入力する
          </button>
        </div>
      ) : (
        <>
          {/* 資金状況 */}
          <p className="section-header">資金状況（残高報告 {latest.date.slice(5).replace('-', '/')} 時点）</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <AmountCard label="GMO個人" amount={latest.persBal} sub="残高目安" color="border-green-500" icon={User} />
            <AmountCard label="GMO法人" amount={latest.corpBal} sub="残高目安" color="border-blue-500" icon={Building2} />
            <AmountCard label="現金（レジ金除く）" amount={latest.cashBal} sub="残高目安" color="border-amber-500" icon={Coins} />
            <AmountCard label="実質総資産" amount={latest.realBal}
              sub={`残高計 ${fmtShort(latest.totalBal)} ＋入金予定 −返却予定`} color="border-amber-500" icon={Wallet} />
          </div>

          {/* 今月の収支・明日の予想・支払い予定 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div className={`card border-l-4 ${monthPL !== null && monthPL >= 0 ? 'border-green-500' : 'border-red-500'}`}>
              <div className="card-header flex items-center gap-1">
                {monthPL !== null && monthPL >= 0 ? <TrendingUp size={12}/> : <TrendingDown size={12}/>} 今月の収支（実質）
              </div>
              <div className={`text-2xl font-bold ${monthPL !== null && monthPL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {monthPL !== null ? `${monthPL >= 0 ? '+' : ''}${fmt(monthPL)}` : '—'}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                {monthBase ? `${monthBase.date.slice(5).replace('-', '/')} 基準・これがプラスなら黒字` : ''}
              </div>
            </div>
            <div className="card">
              <div className="card-header flex items-center gap-1"><CalendarClock size={12}/> 明日の着地予想</div>
              <div className="text-2xl font-bold text-gray-700">{tomorrowProj !== null ? fmt(tomorrowProj) : 'データ蓄積中'}</div>
              <div className="text-xs text-gray-400 mt-1">{tomorrowProj !== null ? '実質総資産・直近ペースから試算' : '報告2日分から試算します'}</div>
            </div>
            <button onClick={() => setPage('payments')} className={`card text-left border-l-4 ${short7 || overdueCount > 0 ? 'border-red-500' : 'border-green-500'} hover:bg-gray-50 transition`}>
              <div className="card-header">今後7日の資金繰り</div>
              <div className={`text-2xl font-bold ${short7 ? 'text-red-600' : 'text-green-600'}`}>
                {short7 ? `${fmt(Math.abs(cf7.net))} 不足` : `${fmt(cf7.net)} 余裕`}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                {overdueCount > 0 ? <span className="text-red-500 font-bold">期限超過 {overdueCount}件あり　</span> : ''}
                収入予定{fmtShort(cf7.income)}／支出予定{fmtShort(cf7.expense)}
              </div>
            </button>
          </div>

          {/* 予実の進捗（予算が入っているときだけ出す） */}
          {bg.hasBudget && (
            <button onClick={() => setPage('pl')}
              className="card w-full text-left mb-4 hover:bg-gray-50 transition">
              <div className="flex items-baseline justify-between mb-3">
                <span className="card-header mb-0">予算の進捗</span>
                <span className="text-[11px] text-gray-400">
                  {bg.elapsedDays}/{bg.totalDays}日経過（{Math.round(bg.paceRate * 100)}%）
                </span>
              </div>
              <div className="space-y-3">
                <BudgetBar label="売上" actual={bg.revenueActual} plan={bg.revenueBudget}
                  rate={bg.revenueRate} paceRate={bg.paceRate} color="bg-blue-600" behindIsBad/>
                <BudgetBar label="費用" actual={bg.expenseActual} plan={bg.expenseBudget}
                  rate={bg.expenseRate} paceRate={bg.paceRate} color="bg-orange-500"/>
              </div>
              {bg.dailyRevenueTarget > 0 && bg.elapsedDays > 0 && (
                <p className="text-[11px] text-gray-400 mt-3">
                  1日の売上目標 {fmtShort(bg.dailyRevenueTarget)} ／ 日平均 {fmtShort(Math.round(bg.revenueActual / bg.elapsedDays))}
                </p>
              )}
            </button>
          )}

          {/* 資産推移チャート */}
          <div className="card mb-4">
            <div className="card-header">資産推移（今月）</div>
            {chartData.length >= 2 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                    tickFormatter={(v: number) => `${Math.round(v / 10000)}万`} width={40} />
                  <Tooltip formatter={(v) => fmt(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="残高合計" stroke="#0277BD" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="実質総資産" stroke="#F57F17" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-sm text-gray-400 py-6 text-center">報告が2日分たまるとグラフと着地予想が表示されます</div>
            )}
          </div>

          {/* 借入・立替金 */}
          <button onClick={() => setPage('payments')} className="card w-full text-left border-l-4 border-purple-500 mb-4 hover:bg-gray-50 transition">
            <div className="card-header flex items-center gap-1"><Landmark size={12}/> 借入・立替金　残高合計</div>
            <div className="text-2xl font-bold text-purple-700">{fmt(totalLoanRemaining)}</div>
            <div className="text-xs text-gray-400 mt-1">{loans.map(l => `${l.lender} ${fmtShort(Math.max(0, l.totalAmount - l.paidAmount))}`).join(' ／ ')}（詳細・返済記録は資金繰りへ）</div>
          </button>

          {/* 直近の残高報告 */}
          <p className="section-header">直近の残高報告</p>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-gray-400 text-xs">
                  <th className="text-left py-2 pr-3">日付</th>
                  <th className="text-right pr-3">GMO個人</th>
                  <th className="text-right pr-3">GMO法人</th>
                  <th className="text-right pr-3">現金</th>
                  <th className="text-right">実質総資産</th>
                </tr>
              </thead>
              <tbody>
                {series.filter(s => s.date <= todayStr).slice(-7).reverse().map(s => (
                  <tr key={s.date} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-1.5 pr-3 text-gray-500">{s.date.slice(5)}</td>
                    <td className="text-right pr-3 text-green-700">{fmtShort(s.persBal)}</td>
                    <td className="text-right pr-3 text-blue-700">{fmtShort(s.corpBal)}</td>
                    <td className="text-right pr-3 text-amber-700">{fmtShort(s.cashBal)}</td>
                    <td className="text-right font-bold text-gray-700">{fmtShort(s.realBal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
