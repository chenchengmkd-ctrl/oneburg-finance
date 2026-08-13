import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { fmt, fmtShort } from '../../utils/calculations'
import {
  monthsOf, calcMonthStats, calcWeekdayStats, calcDailySeries, compareGroups, flVerdict,
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
  const { reports, loadReports } = useAppStore()
  const [compareBy, setCompareBy] = useState<'label' | 'vendor'>('label')

  useEffect(() => { loadReports() }, [])

  const months = useMemo(() => monthsOf(reports), [reports])
  const monthStats = useMemo(() => calcMonthStats(reports, months), [reports, months])
  const weekday = useMemo(() => calcWeekdayStats(reports, months), [reports, months])
  const daily = useMemo(() => calcDailySeries(reports, months), [reports, months])

  const latest = monthStats[monthStats.length - 1]
  const prev = monthStats[monthStats.length - 2]

  const comparison = useMemo(() => {
    if (months.length < 2) return []
    return compareGroups(reports, months[months.length - 1], months[months.length - 2], compareBy)
      .filter(r => r.diff !== 0)
  }, [reports, months, compareBy])

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

  return (
    <div className="p-4 sm:p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">分析</h1>
        <p className="text-gray-400 text-sm">
          金額はすべて税抜。平均は「売上が立った日」だけで計算しています（休業日は含めません）
        </p>
      </div>

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

      {/* 月次の推移 */}
      <p className="section-header">月ごとの推移</p>
      <div className="card mb-6">
        <div className="h-64 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={monthStats.map(m => ({
              month: `${Number(m.month.slice(5))}月`,
              売上: m.revenue, 食材: m.food, 人件費: m.labor, その他: m.supplies + m.other, 損益: m.profit,
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
              <Line type="monotone" dataKey="損益" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }}/>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400 text-xs">
                <th className="text-left py-2 pr-3">月</th>
                <th className="text-right pr-3">営業日</th>
                <th className="text-right pr-3">売上</th>
                <th className="text-right pr-3">1日平均</th>
                <th className="text-right pr-3">原価率</th>
                <th className="text-right pr-3">人件費率</th>
                <th className="text-right pr-3">FL比率</th>
                <th className="text-right">損益</th>
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
                    <td className={`text-right pr-3 font-bold ${tone ? VERDICT_STYLE[tone] : 'text-gray-400'}`}>{pctText(m.flRate)}</td>
                    <td className={`text-right font-black ${m.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {m.profit >= 0 ? '+' : ''}{fmtShort(m.profit)}
                    </td>
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

      {/* 日別の推移 */}
      <p className="section-header">日ごとの売上と損益</p>
      <div className="card mb-6">
        <div className="h-56 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={20}/>
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${Math.round(v / 1000)}千`}/>
              <Tooltip formatter={(v) => fmt(Number(v))} labelFormatter={l => `${l}`}/>
              <Legend wrapperStyle={{ fontSize: 12 }}/>
              <Bar dataKey="revenue" name="売上" fill="#93c5fd" radius={[2, 2, 0, 0]}/>
              <Line type="monotone" dataKey="profit" name="損益" stroke="#16a34a" strokeWidth={2} dot={false}/>
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
