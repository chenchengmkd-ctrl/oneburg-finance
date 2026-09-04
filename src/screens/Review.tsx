import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../stores/appStore'
import { fmt, fmtShort, todayStr } from '../utils/calculations'
import { calcPL, calcDailyPL, groupLedger, UNSET_KEY, NO_LABEL_KEY } from '../utils/plCalc'
import type { PLGroupRow } from '../utils/plCalc'
import { monthsOf, calcMonthStats, calcWeekdayStats, rankItems, summarizeUsage, flVerdict } from '../utils/analyticsCalc'
import { calcBudget, isOverPace, isBehindPace } from '../utils/budgetCalc'
import { downloadCsv } from '../utils/csvExport'
import { EXPENSE_CATEGORY_LABEL } from '../types'
import type { ExpenseCategory } from '../types'
import { ChevronLeft, ChevronRight, ChevronDown, Download, X } from 'lucide-react'

// ふりかえり：旧「損益表」と「分析」を1画面にまとめたもの（2026-09の画面刷新）。
// 上から順に「結果 → 内訳 → 細かい記録」の粒度で並べ、下のセクションほど折りたたんでおく

const VERDICT_STYLE = { good: 'text-green-600', warn: 'text-amber-600', bad: 'text-red-600' } as const
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)

function Section({ title, sub, defaultOpen = false, children }: {
  title: string; sub?: string; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card mb-3">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between text-left">
        <span>
          <span className="text-sm font-bold text-gray-700">{title}</span>
          {sub && <span className="text-[11px] text-gray-400 ml-2">{sub}</span>}
        </span>
        <ChevronDown size={16} className={`text-gray-300 transition ${open ? 'rotate-180' : ''}`}/>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
  )
}

// 指標1つ分。率だけ見せても判断できないので、目安を必ず添える
function Stat({ label, value, sub, tone }: {
  label: string; value: string; sub: string; tone?: 'good' | 'warn' | 'bad' | null
}) {
  return (
    <div>
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className={`text-xl font-black ${tone ? VERDICT_STYLE[tone] : 'text-gray-800'}`}>{value}</div>
      <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>
    </div>
  )
}

// 仕入れ先別／品目別の集計カード。行を押すともう片方がその内訳だけに絞り込まれる
function GroupCard({ title, unsetKey, unsetLabel, rows, selected, onSelect }: {
  title: string; unsetKey: string; unsetLabel: string; rows: PLGroupRow[]
  selected: string | null; onSelect: (key: string) => void
}) {
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const max = Math.max(1, ...rows.map(r => r.amount))
  const unset = rows.find(r => r.key === unsetKey)
  const unsetPct = unset && total > 0 ? Math.round((unset.amount / total) * 100) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs font-bold text-gray-500">{title}<span className="ml-1.5 text-gray-300 font-normal">{rows.length}件</span></span>
        <span className="text-sm font-black text-gray-700">{fmt(total)}</span>
      </div>
      {unset && (
        <button onClick={() => onSelect(unset.key)}
          className="w-full text-left text-[11px] mb-2 px-1.5 py-1 rounded flex items-center justify-between bg-orange-50 text-orange-700 hover:bg-orange-100">
          <span>{unsetLabel}</span>
          <span className="font-bold">{fmt(unset.amount)}（{unsetPct}%・{unset.count}件）</span>
        </button>
      )}
      <div className="space-y-1">
        {rows.map(r => (
          <button key={r.key} onClick={() => onSelect(r.key)}
            className={`w-full text-left px-1.5 py-1 rounded transition ${selected === r.key ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-gray-700">{r.key}</span>
              <span className="font-bold text-gray-600 shrink-0">{fmtShort(r.amount)}</span>
            </div>
            <div className="h-1 bg-gray-100 rounded mt-0.5 overflow-hidden">
              <div className="h-full bg-gray-300 rounded" style={{ width: `${(r.amount / max) * 100}%` }}/>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function Review() {
  const {
    settings, reports, salesDetails, budget,
    loadSettings, loadReports, loadSalesDetails, loadBudget, saveSettings, setPage, setSelectedDate,
  } = useAppStore()
  const [vendorSel, setVendorSel] = useState<string | null>(null)
  const [labelSel, setLabelSel] = useState<string | null>(null)

  useEffect(() => { loadSettings(); loadReports(); loadSalesDetails(); loadBudget() }, [])

  const today = todayStr()
  const month = settings.targetMonth || today.slice(0, 7)
  const changeMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    saveSettings({ ...settings, targetMonth: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })
  }

  const pl = useMemo(() => calcPL(reports, month), [reports, month])
  const daily = useMemo(() => calcDailyPL(reports, month), [reports, month])
  const bg = useMemo(() => calcBudget(reports, budget, month, today), [reports, budget, month, today])
  const months = useMemo(() => monthsOf(reports), [reports])
  const monthStats = useMemo(() => calcMonthStats(reports, months), [reports, months])
  const weekday = useMemo(() => calcWeekdayStats(reports, months), [reports, months])

  const stat = monthStats.find(s => s.month === month)
  const prevStat = monthStats[monthStats.findIndex(s => s.month === month) - 1]
  const openDays = daily.filter(d => d.revenueNet > 0).length

  // 仕入れ先別・品目別（人件費と0円行は除く）
  const ledger = useMemo(
    () => pl.ledger.filter(r => r.category !== 'labor' && r.net !== 0),
    [pl.ledger],
  )
  const vendorRows = useMemo(
    () => groupLedger(labelSel ? ledger.filter(r => (r.label || NO_LABEL_KEY) === labelSel) : ledger, r => r.vendor),
    [ledger, labelSel],
  )
  const labelRows = useMemo(
    () => groupLedger(vendorSel ? ledger.filter(r => (r.vendor || UNSET_KEY) === vendorSel) : ledger, r => r.label),
    [ledger, vendorSel],
  )

  // Squareの記録（その月のぶんだけ）
  const details = useMemo(
    () => Object.values(salesDetails).filter(d => d.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date)),
    [salesDetails, month],
  )
  const itemRanks = useMemo(() => rankItems(details), [details])
  const usage = useMemo(() => summarizeUsage(details), [details])

  const profitable = pl.profitNet >= 0
  const maxWeekdayRevenue = Math.max(1, ...weekday.map(w => w.avgRevenue))

  const exportDaily = () => downloadCsv(`日別_${month}.csv`, [
    ['日付', '売上(税抜)', '食材', '備品', '人件費', 'その他', '費用計(税抜)', '利益(税抜)'],
    ...daily.map(d => [
      d.date, d.revenueNet,
      d.expenseByCategory.ingredient, d.expenseByCategory.supplies, d.expenseByCategory.labor,
      d.expenseByCategory.rent + d.expenseByCategory.utility + d.expenseByCategory.other,
      d.expenseNet, d.profitNet,
    ]),
  ])
  const exportLedger = () => downloadCsv(`支出明細_${month}.csv`, [
    ['日付', '仕入れ先', '品目', 'カテゴリ', '金額(税込)', '金額(税抜)'],
    ...pl.ledger.map(r => [r.date, r.vendor, r.label, EXPENSE_CATEGORY_LABEL[r.category], r.amount, r.net]),
  ])

  return (
    <div className="p-4 sm:p-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-5">
        <h1 className="text-2xl font-bold text-gray-800">ふりかえり</h1>
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => changeMonth(-1)} className="p-1.5 rounded hover:bg-gray-200"><ChevronLeft size={18}/></button>
          <span className="text-sm font-bold text-gray-600 w-20 text-center">{month.replace('-', '/')}</span>
          <button onClick={() => changeMonth(1)} className="p-1.5 rounded hover:bg-gray-200"><ChevronRight size={18}/></button>
        </div>
      </div>

      {/* 月の成績 */}
      <div className={`card border-l-4 mb-3 ${profitable ? 'border-green-500' : 'border-red-500'}`}>
        <div className="card-header flex items-center justify-between">
          <span>{Number(month.slice(5))}月の利益</span>
          <span className="text-[10px] font-normal text-gray-400">税抜・営業{openDays}日</span>
        </div>
        <div className={`text-3xl font-black ${profitable ? 'text-green-600' : 'text-red-600'}`}>
          {profitable ? '+' : ''}{fmt(pl.profitNet)}
        </div>
        {prevStat && stat && (
          <div className="text-[11px] text-gray-400 mt-1">
            前月（{prevStat.month.replace('-', '/')}）は {fmt(prevStat.profit)}／
            売上は {stat.revenue >= prevStat.revenue ? '+' : ''}{fmtShort(stat.revenue - prevStat.revenue)}
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-3 text-sm border-t border-gray-100 pt-3">
          <div className="flex justify-between"><span className="text-gray-500">売上</span><span className="font-bold text-blue-700">{fmt(pl.revenueNet)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">費用</span><span className="font-bold text-orange-700">-{fmt(pl.expenseNet)}</span></div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          {(['ingredient', 'labor', 'supplies', 'other'] as ExpenseCategory[]).map(cat => {
            const line = pl.expenseByCategory.find(l => l.category === cat)
            const extra = cat === 'other'
              ? (pl.expenseByCategory.find(l => l.category === 'rent')?.amount ?? 0)
                + (pl.expenseByCategory.find(l => l.category === 'utility')?.amount ?? 0)
              : 0
            return (
              <div key={cat}>
                <div className="text-[11px] text-gray-400">{cat === 'other' ? 'その他（家賃・光熱費含む）' : EXPENSE_CATEGORY_LABEL[cat]}</div>
                <div className="text-base font-bold text-gray-700">{fmtShort((line?.amount ?? 0) + extra)}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 効率の指標 */}
      {stat && (
        <div className="card mb-3">
          <div className="card-header">効率（目安と見比べる）</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="1日あたり売上" value={fmtShort(stat.avgRevenue)} sub={`営業${stat.openDays}日の平均`}/>
            <Stat label="原価率（食材）" value={pct(stat.foodRate)} sub="目安 30%以下"
              tone={stat.foodRate === null ? null : stat.foodRate <= 0.3 ? 'good' : stat.foodRate <= 0.35 ? 'warn' : 'bad'}/>
            <Stat label="人件費率" value={pct(stat.laborRate)} sub="目安 30%以下"
              tone={stat.laborRate === null ? null : stat.laborRate <= 0.3 ? 'good' : stat.laborRate <= 0.35 ? 'warn' : 'bad'}/>
            <Stat label="FL比率" value={pct(stat.flRate)} sub="食材＋人件費。目安 60%以下" tone={flVerdict(stat.flRate)}/>
          </div>
        </div>
      )}

      {/* 予実 */}
      {bg.hasBudget && (
        <div className="card mb-3">
          <div className="card-header flex items-center justify-between">
            <span>予算に対して</span>
            <span className="text-[11px] font-normal text-gray-400">{bg.elapsedDays}/{bg.totalDays}日経過（{Math.round(bg.paceRate * 100)}%）</span>
          </div>
          <div className="space-y-3">
            {[
              { label: '売上', actual: bg.revenueActual, plan: bg.revenueBudget, rate: bg.revenueRate, color: 'bg-blue-600', behindIsBad: true },
              { label: '費用', actual: bg.expenseActual, plan: bg.expenseBudget, rate: bg.expenseRate, color: 'bg-orange-500', behindIsBad: false },
            ].filter(r => r.plan > 0).map(r => {
              const p = Math.round((r.rate ?? 0) * 100)
              const bad = r.behindIsBad ? isBehindPace(r.rate, bg.paceRate) : isOverPace(r.rate, bg.paceRate)
              return (
                <div key={r.label}>
                  <div className="flex items-baseline justify-between text-sm mb-1">
                    <span className="text-gray-600">{r.label}</span>
                    <span className="flex items-baseline gap-2">
                      <span className={`text-[11px] ${bad ? 'text-red-500 font-bold' : 'text-gray-400'}`}>{p}%</span>
                      <span className="font-bold text-gray-700">{fmtShort(r.actual)}</span>
                      <span className="text-[11px] text-gray-400">／ {fmtShort(r.plan)}</span>
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded overflow-hidden relative">
                    <div className={`h-full ${r.color} rounded`} style={{ width: `${Math.min(100, p)}%` }}/>
                    {bg.paceRate > 0 && bg.paceRate < 1 && (
                      <div className="absolute top-0 h-full w-px bg-gray-600/70" style={{ left: `${bg.paceRate * 100}%` }}/>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 何にいくら使ったか */}
      <Section title="何にいくら使ったか" sub="仕入れ先別・品目別（人件費を除く）" defaultOpen>
        {(vendorSel || labelSel) && (
          <button onClick={() => { setVendorSel(null); setLabelSel(null) }}
            className="mb-3 text-xs text-blue-600 flex items-center gap-1 hover:text-blue-800">
            <X size={12}/> 絞り込みを解除（{vendorSel || labelSel}）
          </button>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <GroupCard title="仕入れ先別" unsetKey={UNSET_KEY} unsetLabel="仕入れ先が未入力"
            rows={vendorRows} selected={vendorSel} onSelect={k => setVendorSel(vendorSel === k ? null : k)}/>
          <GroupCard title="品目別" unsetKey={NO_LABEL_KEY} unsetLabel="品目が未入力（何に使ったか不明）"
            rows={labelRows} selected={labelSel} onSelect={k => setLabelSel(labelSel === k ? null : k)}/>
        </div>
        <button onClick={exportLedger} className="mt-4 text-xs text-gray-500 flex items-center gap-1 hover:text-gray-700">
          <Download size={12}/> 支出明細をCSVで出す
        </button>
      </Section>

      {/* 日別 */}
      <Section title="日別" sub={`${daily.length}日分`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400">
                <th className="text-left py-1.5 pr-2">日付</th>
                <th className="text-right pr-2">売上</th>
                <th className="text-right pr-2">食材</th>
                <th className="text-right pr-2">人件費</th>
                <th className="text-right pr-2">その他</th>
                <th className="text-right">利益</th>
              </tr>
            </thead>
            <tbody>
              {daily.map(d => (
                <tr key={d.date} onClick={() => { setSelectedDate(d.date); setPage('daily') }}
                  className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                  <td className="py-1.5 pr-2 text-gray-500">{d.date.slice(5)}</td>
                  <td className="text-right pr-2 text-blue-700">{fmtShort(d.revenueNet)}</td>
                  <td className="text-right pr-2 text-gray-500">{fmtShort(d.expenseByCategory.ingredient)}</td>
                  <td className="text-right pr-2 text-gray-500">{fmtShort(d.expenseByCategory.labor)}</td>
                  <td className="text-right pr-2 text-gray-500">
                    {fmtShort(d.expenseByCategory.supplies + d.expenseByCategory.other + d.expenseByCategory.rent + d.expenseByCategory.utility)}
                  </td>
                  <td className={`text-right font-bold ${d.profitNet >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtShort(d.profitNet)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={exportDaily} className="mt-3 text-xs text-gray-500 flex items-center gap-1 hover:text-gray-700">
          <Download size={12}/> 日別をCSVで出す
        </button>
      </Section>

      {/* Squareの記録 */}
      <Section title="売れたもの・使った量" sub="Squareのレジ記録から">
        {details.length === 0 ? (
          <p className="text-xs text-gray-400">この月のレジ記録はまだ取り込まれていません。</p>
        ) : (
          <>
            {usage.days > 0 && (
              <div className="flex flex-wrap gap-6 mb-4 pb-4 border-b border-gray-100">
                <Stat label="鰻の使用量" value={`約${usage.tails}尾`} sub={`1日平均 ${usage.avgTails}尾（${usage.days}日分）`}/>
                <Stat label="ご飯の使用量" value={`約${usage.riceKg}kg`} sub={`1日平均 ${usage.avgRiceKg}kg`}/>
                <Stat label="鰻重の販売数" value={`${usage.servings}食`} sub="出数からの目安"/>
              </div>
            )}
            <div className="text-xs font-bold text-gray-500 mb-2">出数ランキング</div>
            <div className="space-y-1">
              {itemRanks.slice(0, 12).map(r => (
                <div key={r.name} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate text-gray-700">{r.name}</span>
                  <span className="shrink-0 text-gray-400">{r.qty}個</span>
                  <span className="shrink-0 font-bold text-gray-600 w-16 text-right">{fmtShort(r.amount)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      {/* 曜日別 */}
      <Section title="曜日ごとの成績" sub="売上と人件費だけで比べる（全期間）">
        <p className="text-[11px] text-gray-400 mb-3">
          仕入れや家賃は数日おき・月1回にまとまって出るため、たまたま当たった曜日だけが沈んで見えます。
          毎日発生する売上と人件費だけで比べています
        </p>
        <div className="space-y-2">
          {weekday.filter(w => w.openDays > 0).map(w => (
            <div key={w.dow}>
              <div className="flex items-baseline justify-between text-xs mb-0.5">
                <span className="text-gray-600">{w.label}<span className="text-gray-300 ml-1">{w.openDays}日</span></span>
                <span className="flex items-baseline gap-3">
                  <span className="text-gray-400">売上 {fmtShort(w.avgRevenue)}</span>
                  <span className="text-gray-400">人件費 {fmtShort(w.avgLabor)}</span>
                  <span className="font-bold text-gray-700 w-16 text-right">{fmtShort(w.avgAfterLabor)}</span>
                </span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded overflow-hidden">
                <div className="h-full bg-blue-500 rounded" style={{ width: `${(w.avgRevenue / maxWeekdayRevenue) * 100}%` }}/>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* 月ごとの推移 */}
      <Section title="月ごとの推移" sub={`${monthStats.length}か月分`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400">
                <th className="text-left py-1.5 pr-2">月</th>
                <th className="text-right pr-2">営業</th>
                <th className="text-right pr-2">売上</th>
                <th className="text-right pr-2">費用</th>
                <th className="text-right pr-2">利益</th>
                <th className="text-right pr-2">原価率</th>
                <th className="text-right">FL</th>
              </tr>
            </thead>
            <tbody>
              {monthStats.map(s => (
                <tr key={s.month} className={`border-b border-gray-50 ${s.month === month ? 'bg-blue-50' : ''}`}>
                  <td className="py-1.5 pr-2 text-gray-600">{s.month.replace('-', '/')}</td>
                  <td className="text-right pr-2 text-gray-400">{s.openDays}日</td>
                  <td className="text-right pr-2 text-blue-700">{fmtShort(s.revenue)}</td>
                  <td className="text-right pr-2 text-orange-700">{fmtShort(s.expense)}</td>
                  <td className={`text-right pr-2 font-bold ${s.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtShort(s.profit)}</td>
                  <td className="text-right pr-2 text-gray-500">{pct(s.foodRate)}</td>
                  <td className="text-right text-gray-500">{pct(s.flRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
