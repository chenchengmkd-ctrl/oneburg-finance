import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { defaultReport, newLineItem, sumItems, usedLabels } from '../../utils/storage'
import { buildReportSeries, latestPendingBefore, buildReportText } from '../../utils/reportCalc'
import { fmt, fmtShort, getDayOfWeek, isWeekend } from '../../utils/calculations'
import type { BalanceReport, LineItem, ExpenseCategory } from '../../types'
import { EXPENSE_CATEGORY_LABEL } from '../../types'
import { ChevronLeft, ChevronRight, Copy, Check, User, Building2, Coins, List, Pencil, Plus, X } from 'lucide-react'
import ReportList from './ReportList'
import NumberInput from '../common/NumberInput'

function NInput({ label, value, onChange, ring, hint }: {
  label: string; value: number; onChange: (v: number) => void; ring: string; hint?: string
}) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      <NumberInput value={value} onChange={onChange}
        className={`w-full text-right px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 ${ring} text-sm`}/>
      {hint && <div className="text-[10px] text-gray-400 mt-0.5">{hint}</div>}
    </div>
  )
}

// 入金・引出の複数明細入力（行の追加・削除、合計を自動表示）
function LineItemsEditor({ label, items, onChange, ring, withCategory, idPrefix, reports }: {
  label: string; items: LineItem[]; onChange: (items: LineItem[]) => void; ring: string; withCategory?: boolean
  idPrefix?: string; reports?: Record<string, BalanceReport>
}) {
  const total = sumItems(items)
  const update = (id: string, patch: Partial<LineItem>) => onChange(items.map(i => i.id === id ? { ...i, ...patch } : i))
  const remove = (id: string) => onChange(items.filter(i => i.id !== id))
  const add = () => onChange([...items, newLineItem(withCategory ? 'other' : undefined)])
  const categories = Object.keys(EXPENSE_CATEGORY_LABEL) as ExpenseCategory[]

  return (
    <div className="col-span-2">
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-gray-500">{label}</label>
        <span className="text-xs font-bold text-gray-600">合計 {fmtShort(total)}</span>
      </div>
      {withCategory && reports && categories.map(cat => (
        <datalist key={cat} id={`${idPrefix}-labels-${cat}`}>
          {usedLabels(reports, cat).map(l => <option key={l} value={l}/>)}
        </datalist>
      ))}
      <div className="space-y-1">
        {items.map(item => (
          <div key={item.id} className="flex items-center gap-1">
            <input type="text" value={item.label} onChange={e => update(item.id, { label: e.target.value })}
              list={withCategory ? `${idPrefix}-labels-${item.category || 'other'}` : undefined}
              placeholder="内容" className={`flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 ${ring}`}/>
            <NumberInput value={item.amount} onChange={v => update(item.id, { amount: v })}
              className={`w-24 text-right text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 ${ring}`}/>
            {withCategory && (
              <select value={item.category || 'other'} onChange={e => update(item.id, { category: e.target.value as ExpenseCategory })}
                className="text-[10px] border border-gray-200 rounded px-1 py-1 w-20 shrink-0">
                {Object.entries(EXPENSE_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            )}
            <button onClick={() => remove(item.id)} className="text-gray-300 hover:text-red-500 shrink-0"><X size={12}/></button>
          </div>
        ))}
        {items.length === 0 && <div className="text-[10px] text-gray-300">なし</div>}
      </div>
      <button onClick={add} className="text-[10px] text-blue-600 mt-1 flex items-center gap-0.5 hover:text-blue-800">
        <Plus size={10}/> 行を追加
      </button>
    </div>
  )
}

// 昨日残・残高目安：自動値を表示しつつ手入力で上書き（空にすると自動に戻る）
function OverrideInput({ label, autoValue, override, onChange, ring }: {
  label: string; autoValue: number; override: number | null
  onChange: (v: number | null) => void; ring: string
}) {
  const [text, setText] = useState(override !== null ? override.toLocaleString('ja-JP') : '')
  useEffect(() => { setText(override !== null ? override.toLocaleString('ja-JP') : '') }, [override])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '')
    if (raw === '') { setText(''); onChange(null); return }
    const num = Number(raw)
    setText(num.toLocaleString('ja-JP'))
    onChange(num)
  }

  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      <input
        type="text"
        inputMode="numeric"
        value={text}
        onChange={handleChange}
        placeholder={autoValue.toLocaleString('ja-JP')}
        className={`w-full text-right px-2 py-1 border rounded focus:outline-none focus:ring-2 ${ring} text-sm ${override !== null ? 'border-amber-300 bg-amber-50' : 'border-gray-200'}`}
      />
      <div className="text-[10px] text-gray-400 mt-0.5">
        {override !== null ? '手動上書き中（空にすると自動）' : '自動（前日から引継ぎ・計算）'}
      </div>
    </div>
  )
}

export default function Report() {
  const { reports, loadReports, saveReport, selectedDate, setSelectedDate } = useAppStore()
  const [copied, setCopied] = useState(false)
  const [viewMode, setViewMode] = useState<'input' | 'list'>('input')

  useEffect(() => { loadReports() }, [])

  const report: BalanceReport = reports[selectedDate]
    ?? defaultReport(selectedDate, latestPendingBefore(reports, selectedDate))

  // 当日分の下書きも含めて残高チェーンを再計算
  const series = useMemo(
    () => buildReportSeries({ ...reports, [selectedDate]: report }),
    [reports, selectedDate, report]
  )
  // 一覧表示用：入力中の下書きを含めない、保存済みデータのみのチェーン
  const savedSeries = useMemo(() => buildReportSeries(reports), [reports])
  const day = series.find(s => s.date === selectedDate)!
  const reportText = buildReportText(day)

  const changeDate = (delta: number) => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + delta)
    setSelectedDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }

  const save = (patch: Partial<BalanceReport>) => saveReport({ ...report, ...patch })
  const savePers = (p: Partial<BalanceReport['pers']>) => save({ pers: { ...report.pers, ...p } })
  const saveCorp = (p: Partial<BalanceReport['corp']>) => save({ corp: { ...report.corp, ...p } })
  const saveCash = (p: Partial<BalanceReport['cash']>) => save({ cash: { ...report.cash, ...p } })
  const savePending = (p: Partial<BalanceReport['pending']>) => save({ pending: { ...report.pending, ...p } })

  const copyText = async () => {
    await navigator.clipboard.writeText(reportText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const dayOfWeek = getDayOfWeek(selectedDate)
  const weekend = isWeekend(selectedDate)

  const ToggleBtn = ({ mode, icon: Icon, label }: { mode: 'input' | 'list'; icon: React.ElementType; label: string }) => (
    <button onClick={() => setViewMode(mode)}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${viewMode === mode ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
      <Icon size={14}/> {label}
    </button>
  )

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          {viewMode === 'input' && (
            <button onClick={() => changeDate(-1)} className="p-1.5 rounded hover:bg-gray-200 transition"><ChevronLeft size={20}/></button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              {viewMode === 'input' ? (
                <>{selectedDate}<span className={`ml-2 text-lg ${weekend ? 'text-red-500' : 'text-gray-400'}`}>({dayOfWeek})</span></>
              ) : '残高報告 一覧'}
            </h1>
            <p className="text-gray-400 text-sm">
              {viewMode === 'input' ? '残高報告（毎日の報告をそのまま入力）' : '毎日の報告をまとめて確認・過去分の再コピーができます'}
            </p>
          </div>
          {viewMode === 'input' && (
            <button onClick={() => changeDate(1)} className="p-1.5 rounded hover:bg-gray-200 transition"><ChevronRight size={20}/></button>
          )}
          {viewMode === 'input' && (
            <input type="date" value={selectedDate} onChange={e => e.target.value && setSelectedDate(e.target.value)}
              title="日付を直接指定してジャンプ"
              className="text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"/>
          )}
        </div>
        <div className="flex gap-2">
          <ToggleBtn mode="input" icon={Pencil} label="入力"/>
          <ToggleBtn mode="list" icon={List} label="一覧"/>
        </div>
      </div>

      {viewMode === 'list' ? (
        <ReportList series={savedSeries} onEdit={(date) => { setSelectedDate(date); setViewMode('input') }} />
      ) : (
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          {/* GMO個人 */}
          <div className="card border-l-4 border-green-500">
            <div className="flex items-center gap-1.5 text-xs font-bold text-green-600 uppercase tracking-wide mb-3">
              <User size={14}/> GMO個人
            </div>
            <div className="grid grid-cols-2 gap-3">
              <OverrideInput label="昨日残" autoValue={day.persPrev} override={report.pers.prevOverride}
                onChange={v => savePers({ prevOverride: v })} ring="focus:ring-green-400"/>
              <NInput label="入金予定" value={report.pending.persExpected} onChange={v => savePending({ persExpected: v })} ring="focus:ring-green-400"/>
              <LineItemsEditor label="入金" items={report.pers.deposits} onChange={items => savePers({ deposits: items })} ring="focus:ring-green-400"/>
              <LineItemsEditor label="引出" items={report.pers.withdraws} onChange={items => savePers({ withdraws: items })} ring="focus:ring-green-400" withCategory idPrefix="pers-w" reports={reports}/>
              <OverrideInput label="残高目安（実測補正）" autoValue={day.persBal} override={report.pers.balanceOverride}
                onChange={v => savePers({ balanceOverride: v })} ring="focus:ring-green-400"/>
            </div>
          </div>

          {/* GMO法人 */}
          <div className="card border-l-4 border-blue-500">
            <div className="flex items-center gap-1.5 text-xs font-bold text-blue-600 uppercase tracking-wide mb-3">
              <Building2 size={14}/> GMO法人
            </div>
            <div className="grid grid-cols-2 gap-3">
              <OverrideInput label="昨日残" autoValue={day.corpPrev} override={report.corp.prevOverride}
                onChange={v => saveCorp({ prevOverride: v })} ring="focus:ring-blue-400"/>
              <NInput label="スクエア入金予定" value={report.pending.corpSquare} onChange={v => savePending({ corpSquare: v })} ring="focus:ring-blue-400"/>
              <OverrideInput label="残高目安（実測補正）" autoValue={day.corpBal} override={report.corp.balanceOverride}
                onChange={v => saveCorp({ balanceOverride: v })} ring="focus:ring-blue-400"/>
              <LineItemsEditor label="入金（現金からの銀行入金は自動加算）" items={report.corp.deposits} onChange={items => saveCorp({ deposits: items })} ring="focus:ring-blue-400"/>
              <LineItemsEditor label="引出" items={report.corp.withdraws} onChange={items => saveCorp({ withdraws: items })} ring="focus:ring-blue-400" withCategory idPrefix="corp-w" reports={reports}/>
            </div>
          </div>

          {/* 屋台うなぎ現金 */}
          <div className="card border-l-4 border-amber-500">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-600 uppercase tracking-wide mb-3">
              <Coins size={14}/> 屋台うなぎ現金（レジ金除く）
            </div>
            <div className="grid grid-cols-2 gap-3">
              <OverrideInput label="昨日残" autoValue={day.cashPrev} override={report.cash.prevOverride}
                onChange={v => saveCash({ prevOverride: v })} ring="focus:ring-amber-400"/>
              <NInput label="本日現金売上" value={report.cash.sales} onChange={v => saveCash({ sales: v })} ring="focus:ring-amber-400"/>
              <NInput label="銀行入金（→法人口座）" value={report.cash.toBank} onChange={v => saveCash({ toBank: v })} ring="focus:ring-amber-400"/>
              <NInput label="今後返却予定" value={report.pending.cashReturn} onChange={v => savePending({ cashReturn: v })} ring="focus:ring-amber-400"/>
              <OverrideInput label="残高目安（実測補正）" autoValue={day.cashBal} override={report.cash.balanceOverride}
                onChange={v => saveCash({ balanceOverride: v })} ring="focus:ring-amber-400"/>
              <LineItemsEditor label="手渡し・現金払い（内訳）" items={report.cash.withdraws} onChange={items => saveCash({ withdraws: items })} ring="focus:ring-amber-400" withCategory idPrefix="cash-w" reports={reports}/>
            </div>
          </div>

          <div className="card">
            <label className="text-xs text-gray-500 block mb-1">メモ（報告文の末尾に追記）</label>
            <textarea value={report.note} onChange={e => save({ note: e.target.value })}
              rows={2} className="w-full text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-gray-300 resize-none" placeholder="備考・特記事項"/>
          </div>
        </div>

        <div className="space-y-4">
          {/* 本日サマリー */}
          <div className="card bg-amber-50 border border-amber-200">
            <div className="card-header text-amber-700">本日の資金状況</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-600">GMO個人</span><span className="font-bold text-green-700">{fmt(day.persBal)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">GMO法人</span><span className="font-bold text-blue-700">{fmt(day.corpBal)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">現金</span><span className="font-bold text-amber-700">{fmt(day.cashBal)}</span></div>
              <div className="border-t pt-2 flex justify-between">
                <span className="font-bold">残高合計</span>
                <span className="font-black">{fmt(day.totalBal)}</span>
              </div>
              <div className="text-xs text-gray-500 space-y-1 pt-1">
                <div className="flex justify-between"><span>＋スクエア入金予定</span><span>{fmt(report.pending.corpSquare)}</span></div>
                <div className="flex justify-between"><span>＋入金予定（個人）</span><span>{fmt(report.pending.persExpected)}</span></div>
                <div className="flex justify-between"><span>−今後返却予定</span><span>-{fmt(report.pending.cashReturn)}</span></div>
              </div>
              <div className="border-t pt-2 flex justify-between">
                <span className="font-bold">実質総資産</span>
                <span className={`font-black text-lg ${day.realBal >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(day.realBal)}</span>
              </div>
            </div>
          </div>

          {/* 報告テキスト */}
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <div className="card-header mb-0">報告テキスト（自動生成）</div>
              <button onClick={copyText}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${copied ? 'bg-green-600 text-white' : 'bg-blue-700 text-white hover:bg-blue-800'}`}>
                {copied ? <><Check size={14}/> コピーしました</> : <><Copy size={14}/> コピー</>}
              </button>
            </div>
            <pre className="text-xs text-gray-700 bg-gray-50 rounded p-3 whitespace-pre-wrap leading-relaxed">{reportText}</pre>
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
