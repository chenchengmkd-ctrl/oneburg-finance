import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { fmt, fmtShort, todayStr } from '../../utils/calculations'
import {
  monthsOf, calcMonthStats, calcWeekdayStats, calcDailySeries, compareGroups, flVerdict,
  rankItems, calcCustomerWeekday, calcHourly, summarizeCustomers, calcWeeklyStats, calcMonthForecast,
  calcCashflowWeeks,
} from '../../utils/analyticsCalc'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, BarChart,
} from 'recharts'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

const pctText = (v: number | null) => (v === null ? '-' : `${Math.round(v * 100)}%`)

const VERDICT_STYLE = {
  good: 'text-green-600',
  warn: 'text-amber-600',
  bad: 'text-red-600',
} as const

// 指標1つ分のカード。数値の意味と目安を必ず添える（率だけ見せても判断できないため）
function StatCard({ label, value, sub, tone }: {
  label: string; value: string; sub: string; tone?: 'good' | 'warn' | 'bad' | null
}) {
  return (
    <div className="card">
      <div className="card-header">{label}</div>
      <div className={`text-2xl font-black ${tone ? VERDICT_STYLE[tone] : 'text-gray-800'}`}>{value}</div>
      <div className="text-[11px] text-gray-400 mt-1">{sub}</div>
    </div>
  )
}

function DiffBadge({ diff }: { diff: number }) {
  if (diff === 0) return <span className="text-gray-300 flex items-center gap-0.5 text-xs"><Minus size={11}/>±0</span>
  const up = diff > 0
  return (
    <span className={`flex items-center gap-0.5 text-xs font-bold ${up ? 'text-red-600' : 'text-green-600'}`}>
      {up ? <TrendingUp size={11}/> : <TrendingDown size={11}/>}
      {up ? '+' : '−'}{fmtShort(Math.abs(diff))}
    </span>
  )
}

export default function Analytics() {
  const { reports, loadReports, salesDetails, loadSalesDetails, cashflowRecords, loadCashflowRecords, setPage } = useAppStore()
  const [compareBy, setCompareBy] = useState<'label' | 'vendor'>('label')
  const todayIso = todayStr()

  useEffect(() => { loadReports(); loadSalesDetails(); loadCashflowRecords() }, [])

  const months = useMemo(() => monthsOf(reports), [reports])
  const monthStats = useMemo(() => calcMonthStats(reports, months), [reports, months])
  const weekday = useMemo(() => calcWeekdayStats(reports, months), [reports, months])
  const daily = useMemo(() => calcDailySeries(reports, months), [reports, months])
  const weekly = useMemo(() => calcWeeklyStats(reports, months, salesDetails), [reports, months, salesDetails])
  const forecast = useMemo(() => calcMonthForecast(reports, salesDetails, todayIso), [reports, salesDetails, todayIso])

  const latest = monthStats[monthStats.length - 1]
  const prev = monthStats[monthStats.length - 2]

  const comparison = useMemo(() => {
    if (months.length < 2) return []
    return compareGroups(reports, months[months.length - 1], months[months.length - 2], compareBy)
      .filter(r => r.diff !== 0)
  }, [reports, months, compareBy])

  // Squareのレジ明細。取り込み済みの日だけが入る
  const details = useMemo(
    () => Object.values(salesDetails).sort((a, b) => a.date.localeCompare(b.date)),
    [salesDetails],
  )
  const itemRanks = useMemo(() => rankItems(details), [details])
  const custWeekday = useMemo(() => calcCustomerWeekday(details), [details])
  const hourly = useMemo(() => calcHourly(details), [details])
  const custSummary = useMemo(() => summarizeCustomers(details), [details])

  // Squareの現金／現金以外の内訳。過去分すべてを週（木〜水）単位でまとめる
  const cashflowWeeks = useMemo(
    () => calcCashflowWeeks(Object.values(cashflowRecords)),
    [cashflowRecords],
  )

  if (!latest) {
    return (
      <div className="p-4 sm:p-6 max-w-6xl">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">分析</h1>
        <div className="card text-center py-12 text-gray-400 text-sm">
          まだデータがありません。日次入力を始めると、ここに推移が出ます。
        </div>
      </div>
    )
  }

  const bestDay = [...weekday].filter(w => w.openDays > 0).sort((a, b) => b.avgAfterLabor - a.avgAfterLabor)[0]
  const worstDay = [...weekday].filter(w => w.openDays > 0).sort((a, b) => a.avgAfterLabor - b.avgAfterLabor)[0]
  const maxAvgRevenue = Math.max(1, ...weekday.map(w => w.avgRevenue))

  const topItem = itemRanks[0]
  const maxItemAmount = Math.max(1, ...itemRanks.map(r => r.amount))
  const maxAvgCustomers = Math.max(1, ...custWeekday.map(w => w.avgCustomers))

  return (
    <div className="p-4 sm:p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">分析</h1>
        <p className="text-gray-400 text-sm">
          金額はすべて税抜。平均は「売上が立った日」だけで計算しています（休業日は含めません）
        </p>
      </div>

      {/* 今月の着地予想 */}
      {forecast && (
        <div className="card border-l-4 border-blue-500 mb-6">
          <div className="card-header mb-2">{forecast.month.replace('-', '年')}月の着地予想</div>
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
            <div>
              <div className="text-3xl font-black text-blue-700">{fmt(forecast.projectedRevenue)}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">売上の見込み（税抜）</div>
            </div>
            {forecast.projectedCustomers !== null && (
              <div>
                <div className="text-2xl font-black text-teal-700">{forecast.projectedCustomers.toLocaleString()}組</div>
                <div className="text-[11px] text-gray-400 mt-0.5">客数の見込み</div>
              </div>
            )}
            <div className="text-xs text-gray-400 ml-auto">
              {forecast.daysElapsed}/{forecast.totalDays}日経過・営業{forecast.openDaysSoFar}日
              <br/>ここまでの実績 {fmtShort(forecast.actualRevenue)}
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mt-3 pt-2 border-t border-gray-100">
            ここまでの営業ペースと1日あたり平均をもとに、このまま続いた場合の見込みを機械的に計算したものです
          </p>
        </div>
      )}

      {/* 最新月の主要指標 */}
      <p className="section-header">{latest.month.replace('-', '年')}月の指標（営業{latest.openDays}日）</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="1日あたり売上" value={fmt(latest.avgRevenue)}
          sub={prev ? `前月 ${fmtShort(prev.avgRevenue)}（${latest.avgRevenue >= prev.avgRevenue ? '+' : ''}${fmtShort(latest.avgRevenue - prev.avgRevenue)}）` : '前月のデータなし'}/>
        <StatCard label="原価率（食材）" value={pctText(latest.foodRate)}
          sub="目安 30%以下。売上に対する食材費"
          tone={latest.foodRate === null ? null : latest.foodRate <= 0.3 ? 'good' : latest.foodRate <= 0.35 ? 'warn' : 'bad'}/>
        <StatCard label="人件費率" value={pctText(latest.laborRate)}
          sub="目安 30%以下。売上に対する人件費"
          tone={latest.laborRate === null ? null : latest.laborRate <= 0.3 ? 'good' : latest.laborRate <= 0.35 ? 'warn' : 'bad'}/>
        <StatCard label="FL比率" value={pctText(latest.flRate)}
          sub="食材＋人件費。飲食店の目安は60%以下"
          tone={flVerdict(latest.flRate)}/>
      </div>

      {/* 週次まとめ（月次より短いスパンで直近の勢いを見る） */}
      <p className="section-header">週次まとめ</p>
      <div className="card mb-6">
        <div className="h-56 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekly.map(w => ({ 週: w.label, 売上: w.revenue }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="週" tick={{ fontSize: 11 }}/>
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${Math.round(v / 1000)}千`}/>
              <Tooltip formatter={(v) => fmt(Number(v))}/>
              <Bar dataKey="売上" fill="#1565C0" radius={[3, 3, 0, 0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400 text-xs">
                <th className="text-left py-2 pr-3">週（月〜日）</th>
                <th className="text-right pr-3">営業日</th>
                <th className="text-right pr-3">売上</th>
                <th className="text-right pr-3">1日平均</th>
                <th className="text-right pr-3">客数</th>
                <th className="text-right">客単価</th>
              </tr>
            </thead>
            <tbody>
              {[...weekly].reverse().map(w => (
                <tr key={w.weekStart} className="border-b border-gray-50">
                  <td className="py-1.5 pr-3 font-bold text-gray-700">{w.label}</td>
                  <td className="text-right pr-3 text-gray-500">{w.openDays}日</td>
                  <td className="text-right pr-3 text-blue-700 font-bold">{fmtShort(w.revenue)}</td>
                  <td className="text-right pr-3 text-gray-600">{fmtShort(w.avgRevenue)}</td>
                  <td className="text-right pr-3 text-teal-700">{w.customers !== null ? `${w.customers}組` : '-'}</td>
                  <td className="text-right text-gray-600">{w.perCustomer !== null ? fmtShort(w.perCustomer) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 月次の推移。損益そのものは損益表に任せ、ここではコスト構造だけを見る */}
      <div className="flex items-center justify-between">
        <p className="section-header mb-0">月ごとの推移</p>
        <button onClick={() => setPage('pl')} className="text-xs text-blue-600 hover:underline">損益表で詳しく見る →</button>
      </div>
      <div className="card mb-6">
        <div className="h-64 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={monthStats.map(m => ({
              month: `${Number(m.month.slice(5))}月`,
              売上: m.revenue, 食材: m.food, 人件費: m.labor, その他: m.supplies + m.other,
            }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="month" tick={{ fontSize: 12 }}/>
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${Math.round(v / 10000)}万`}/>
              <Tooltip formatter={(v) => fmt(Number(v))}/>
              <Legend wrapperStyle={{ fontSize: 12 }}/>
              <Bar dataKey="食材" stackId="c" fill="#ef4444"/>
              <Bar dataKey="人件費" stackId="c" fill="#a855f7"/>
              <Bar dataKey="その他" stackId="c" fill="#f59e0b"/>
              <Line type="monotone" dataKey="売上" stroke="#1565C0" strokeWidth={2} dot={{ r: 3 }}/>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400 text-xs">
                <th className="text-left py-2 pr-3">月</th>
                <th className="text-right pr-3">営業日</th>
                <th className="text-right pr-3">売上</th>
                <th className="text-right pr-3">1日平均</th>
                <th className="text-right pr-3">原価率</th>
                <th className="text-right pr-3">人件費率</th>
                <th className="text-right">FL比率</th>
              </tr>
            </thead>
            <tbody>
              {monthStats.map(m => {
                const tone = flVerdict(m.flRate)
                return (
                  <tr key={m.month} className="border-b border-gray-50">
                    <td className="py-1.5 pr-3 font-bold text-gray-700">{m.month.replace('-', '/')}</td>
                    <td className="text-right pr-3 text-gray-500">{m.openDays}日</td>
                    <td className="text-right pr-3 text-blue-700 font-bold">{fmtShort(m.revenue)}</td>
                    <td className="text-right pr-3 text-gray-600">{fmtShort(m.avgRevenue)}</td>
                    <td className="text-right pr-3 text-gray-600">{pctText(m.foodRate)}</td>
                    <td className="text-right pr-3 text-gray-600">{pctText(m.laborRate)}</td>
                    <td className={`text-right font-bold ${tone ? VERDICT_STYLE[tone] : 'text-gray-400'}`}>{pctText(m.flRate)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 曜日別 */}
      <p className="section-header">曜日別の成績</p>
      <div className="card mb-6">
        {bestDay && worstDay && bestDay.dow !== worstDay.dow && (
          <p className="text-sm text-gray-600 mb-1">
            人件費を引いたあとの残りがいちばん多いのは<strong className="text-green-700">{bestDay.label}曜（{fmt(bestDay.avgAfterLabor)}）</strong>、
            いちばん少ないのは<strong className="text-red-700">{worstDay.label}曜（{fmt(worstDay.avgAfterLabor)}）</strong>です。
          </p>
        )}
        <p className="text-[11px] text-gray-400 mb-3">
          毎日発生する売上と人件費だけで比べています。仕入れ・家賃はまとめて払う日があり、
          その曜日だけが沈んで見えてしまうため含めていません
        </p>
        <div className="h-52 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekday.map(w => ({ 曜日: w.label, 平均売上: w.avgRevenue, 人件費を引いた残り: w.avgAfterLabor }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="曜日" tick={{ fontSize: 12 }}/>
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${Math.round(v / 1000)}千`}/>
              <Tooltip formatter={(v) => fmt(Number(v))}/>
              <Legend wrapperStyle={{ fontSize: 12 }}/>
              <Bar dataKey="平均売上" fill="#1565C0" radius={[3, 3, 0, 0]}/>
              <Bar dataKey="人件費を引いた残り" radius={[3, 3, 0, 0]}>
                {weekday.map(w => (
                  <Cell key={w.dow} fill={w.avgAfterLabor >= 0 ? '#16a34a' : '#dc2626'}/>
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400 text-xs">
                <th className="text-left py-2 pr-3">曜日</th>
                <th className="text-right pr-3">営業日数</th>
                <th className="text-right pr-3">平均売上</th>
                <th className="text-right pr-3">平均人件費</th>
                <th className="text-right pr-3">人件費率</th>
                <th className="text-right pr-3">引いた残り</th>
                <th className="text-left pl-3 w-1/4">売上の大きさ</th>
              </tr>
            </thead>
            <tbody>
              {weekday.map(w => (
                <tr key={w.dow} className={`border-b border-gray-50 ${w.openDays === 0 ? 'opacity-40' : ''}`}>
                  <td className={`py-1.5 pr-3 font-bold ${w.dow === 0 || w.dow === 6 ? 'text-red-500' : 'text-gray-700'}`}>{w.label}</td>
                  <td className="text-right pr-3 text-gray-500">{w.openDays > 0 ? `${w.openDays}日` : '-'}</td>
                  <td className="text-right pr-3 text-blue-700 font-bold">{w.openDays > 0 ? fmtShort(w.avgRevenue) : '-'}</td>
                  <td className="text-right pr-3 text-purple-700">{w.openDays > 0 ? fmtShort(w.avgLabor) : '-'}</td>
                  <td className={`text-right pr-3 ${w.laborRate !== null && w.laborRate > 0.35 ? 'text-red-500 font-bold' : 'text-gray-500'}`}>
                    {pctText(w.laborRate)}
                  </td>
                  <td className={`text-right pr-3 font-black ${w.avgAfterLabor >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {w.openDays > 0 ? `${w.avgAfterLabor >= 0 ? '+' : ''}${fmtShort(w.avgAfterLabor)}` : '-'}
                  </td>
                  <td className="pl-3">
                    <div className="h-2 bg-gray-100 rounded overflow-hidden">
                      <div className="h-full bg-blue-600 rounded" style={{ width: `${(w.avgRevenue / maxAvgRevenue) * 100}%` }}/>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Squareのレジ明細（出数・客数）。取り込みがある月だけ出す */}
      {details.length > 0 ? (
        <>
          <p className="section-header">
            レジの明細（Square）／ {custSummary.days}日分・税込
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <StatCard label="客数（のべ）" value={`${custSummary.customers.toLocaleString()}組`}
              sub={`1日あたり ${custSummary.avgCustomers}組`}/>
            <StatCard label="客単価" value={fmt(custSummary.perCustomer)}
              sub="レジ売上 ÷ 会計数"/>
            <StatCard label="出数1位" value={topItem ? `${topItem.qty}個` : '-'}
              sub={topItem ? `${topItem.name}（売上の${Math.round(topItem.share * 100)}%）` : 'データなし'}/>
            <StatCard label="商品数" value={`${itemRanks.length}品`}
              sub="この期間に1つ以上売れたもの"/>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* 出数ランキング */}
            <div className="card">
              <div className="card-header mb-2">出数ランキング</div>
              <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                {itemRanks.map(r => (
                  <div key={r.name}>
                    <div className="flex items-baseline gap-2 text-xs mb-0.5">
                      <span className="flex-1 truncate text-gray-700">{r.name}</span>
                      <span className="text-[10px] text-gray-400 shrink-0">{r.qty}個</span>
                      <span className="font-bold text-gray-700 shrink-0 w-16 text-right">{fmtShort(r.amount)}</span>
                    </div>
                    <div className="h-1 bg-gray-100 rounded overflow-hidden">
                      <div className="h-full bg-blue-600 rounded" style={{ width: `${(r.amount / maxItemAmount) * 100}%` }}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 時間帯 */}
            <div className="card">
              <div className="card-header mb-2">時間帯ごとの会計数</div>
              {hourly.length === 0 ? (
                <div className="text-xs text-gray-400 py-8 text-center">データがありません</div>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                      <XAxis dataKey="label" tick={{ fontSize: 11 }}/>
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false}/>
                      <Tooltip formatter={(v) => `${Number(v)}組`}/>
                      <Bar dataKey="customers" name="会計数" fill="#0d9488" radius={[3, 3, 0, 0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* 曜日ごとの客数・客単価 */}
          <div className="card mb-6 overflow-x-auto">
            <div className="card-header mb-2">曜日ごとの客数と客単価</div>
            <table className="w-full text-sm min-w-[420px]">
              <thead>
                <tr className="border-b border-gray-100 text-gray-400 text-xs">
                  <th className="text-left py-2 pr-3">曜日</th>
                  <th className="text-right pr-3">日数</th>
                  <th className="text-right pr-3">平均客数</th>
                  <th className="text-right pr-3">客単価</th>
                  <th className="text-left pl-3 w-1/3">客数の多さ</th>
                </tr>
              </thead>
              <tbody>
                {custWeekday.map(w => (
                  <tr key={w.dow} className={`border-b border-gray-50 ${w.days === 0 ? 'opacity-40' : ''}`}>
                    <td className={`py-1.5 pr-3 font-bold ${w.dow === 0 || w.dow === 6 ? 'text-red-500' : 'text-gray-700'}`}>{w.label}</td>
                    <td className="text-right pr-3 text-gray-500">{w.days > 0 ? `${w.days}日` : '-'}</td>
                    <td className="text-right pr-3 text-teal-700 font-bold">{w.days > 0 ? `${w.avgCustomers}組` : '-'}</td>
                    <td className="text-right pr-3 text-gray-600">{w.days > 0 ? fmtShort(w.avgPerCustomer) : '-'}</td>
                    <td className="pl-3">
                      <div className="h-2 bg-gray-100 rounded overflow-hidden">
                        <div className="h-full bg-teal-600 rounded" style={{ width: `${(w.avgCustomers / maxAvgCustomers) * 100}%` }}/>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="card mb-6 text-sm text-gray-500">
          <div className="font-bold text-gray-700 mb-1">出数・客数はまだ取り込まれていません</div>
          LINEで「<span className="font-mono">出数取込 2026-07</span>」のように送ると、その月のレジ明細を取り込みます。
          取り込むと、商品ごとの売れた個数・客数・客単価・時間帯の混み具合がここに出ます。
        </div>
      )}

      {/* 資金繰り（現金／現金以外）。Squareの精算サイクル（木〜水）に合わせた週区切りで、過去分すべて表示する。
          LINE側は先週分だけの簡易版なので、全期間はこちらで見る */}
      {cashflowWeeks.length > 0 ? (
        <>
          <p className="section-header">資金繰り（現金／現金以外）／ 週区切りは木〜水（Squareの振込サイクルに合わせています）</p>
          <div className="card mb-6">
            <div className="h-52 -ml-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cashflowWeeks.map(w => ({ 週: w.label, 現金: w.cash, 現金以外: w.noncash }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                  <XAxis dataKey="週" tick={{ fontSize: 11 }}/>
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${Math.round(v / 1000)}千`}/>
                  <Tooltip formatter={(v) => fmt(Number(v))}/>
                  <Legend wrapperStyle={{ fontSize: 12 }}/>
                  <Bar dataKey="現金" stackId="c" fill="#F57F17" radius={[0, 0, 0, 0]}/>
                  <Bar dataKey="現金以外" stackId="c" fill="#1565C0" radius={[3, 3, 0, 0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm min-w-[620px]">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-400 text-xs">
                    <th className="text-left py-2 pr-3">週（木〜水）</th>
                    <th className="text-right pr-3">日数</th>
                    <th className="text-right pr-3">現金</th>
                    <th className="text-right pr-3">現金 平均/日</th>
                    <th className="text-right pr-3">現金以外</th>
                    <th className="text-right">現金以外 平均/日</th>
                  </tr>
                </thead>
                <tbody>
                  {[...cashflowWeeks].reverse().map(w => (
                    <tr key={w.weekStart} className="border-b border-gray-50">
                      <td className="py-1.5 pr-3 font-bold text-gray-700">{w.label}</td>
                      <td className="text-right pr-3 text-gray-500">{w.days}日</td>
                      <td className="text-right pr-3 text-amber-700 font-bold">{fmtShort(w.cash)}</td>
                      <td className="text-right pr-3 text-amber-600">{fmtShort(w.avgCash)}</td>
                      <td className="text-right pr-3 text-blue-700 font-bold">{fmtShort(w.noncash)}</td>
                      <td className="text-right text-blue-600">{fmtShort(w.avgNoncash)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="card mb-6 text-sm text-gray-500">
          <div className="font-bold text-gray-700 mb-1">現金／現金以外の内訳はまだ取り込まれていません</div>
          LINEで「<span className="font-mono">出数取込 2026-07</span>」を送ると、出数と一緒にこちらも取り込まれます。
        </div>
      )}

      {/* 日別の推移 */}
      <p className="section-header">日ごとの売上</p>
      <div className="card mb-6">
        <div className="h-56 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={20}/>
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${Math.round(v / 1000)}千`}/>
              <Tooltip formatter={(v) => fmt(Number(v))} labelFormatter={l => `${l}`}/>
              <Bar dataKey="revenue" name="売上" fill="#93c5fd" radius={[2, 2, 0, 0]}/>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 前月との比較 */}
      {months.length >= 2 && (
        <>
          <div className="flex items-center justify-between">
            <p className="section-header mb-0">
              前月との比較（{months[months.length - 2].replace('-', '/')} → {months[months.length - 1].replace('-', '/')}）
            </p>
            <div className="flex gap-1">
              {([['label', '品目別'], ['vendor', '仕入れ先別']] as const).map(([id, text]) => (
                <button key={id} onClick={() => setCompareBy(id)}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition ${compareBy === id ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  {text}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mt-1 mb-2">増えた順。赤＝支出が増えたもの、緑＝減ったもの（人件費は除く）</p>
          <div className="card overflow-x-auto">
            {comparison.length === 0 ? (
              <div className="text-sm text-gray-400 py-3 text-center">比較できる差がありません</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-400 text-xs">
                    <th className="text-left py-2 pr-3">{compareBy === 'label' ? '品目' : '仕入れ先'}</th>
                    <th className="text-right pr-3">前月</th>
                    <th className="text-right pr-3">当月</th>
                    <th className="text-right">増減</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.map(r => (
                    <tr key={r.key} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-1.5 pr-3 text-gray-700 truncate max-w-[12rem]">{r.key}</td>
                      <td className="text-right pr-3 text-gray-400">{r.previous ? fmtShort(r.previous) : '-'}</td>
                      <td className="text-right pr-3 text-gray-700 font-bold">{r.current ? fmtShort(r.current) : '-'}</td>
                      <td className="text-right"><div className="flex justify-end"><DiffBadge diff={r.diff}/></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
