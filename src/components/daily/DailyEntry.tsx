import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { defaultReport, newShiftEntry, newLineItem, sumItems, sumShiftPay, shiftPay, calcShiftHours, usedLabels, applyShiftsToReport } from '../../utils/storage'
import { calcPL } from '../../utils/plCalc'
import { fmt, fmtShort, fmtHours, getDayOfWeek, isWeekend } from '../../utils/calculations'
import type { BalanceReport, ExpenseCategory, LineItem, ShiftEntry } from '../../types'
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, BarChart3, Plus, X, Users, ClipboardPaste, Pencil, List } from 'lucide-react'
import NumberInput from '../common/NumberInput'
import ShiftBulkImportModal from './ShiftBulkImportModal'
import ShiftList from './ShiftList'

function BigInput({ label, value, onChange, color }: {
  label: string; value: number; onChange: (v: number) => void; color: string
}) {
  return (
    <div>
      <label className={`text-sm font-bold ${color} block mb-1.5`}>{label}</label>
      <NumberInput value={value} onChange={onChange}
        className="w-full text-right text-2xl font-bold px-4 py-3 border-2 border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"/>
    </div>
  )
}

// 食材・備品などの仕入れ：複数明細＋過去に使った項目名を選択肢として提示
function QuickItemsCard({ title, color, category, items, labelOptions, onChange }: {
  title: string; color: string; category: ExpenseCategory
  items: LineItem[]; labelOptions: string[]; onChange: (items: LineItem[]) => void
}) {
  const total = sumItems(items)
  const listId = `quick-labels-${category}`
  const update = (id: string, patch: Partial<LineItem>) => onChange(items.map(i => i.id === id ? { ...i, ...patch } : i))
  const remove = (id: string) => onChange(items.filter(i => i.id !== id))
  const add = () => onChange([...items, newLineItem(category)])

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-3">
        <span className={`text-sm font-bold ${color}`}>{title}</span>
        <span className={`text-lg font-black ${color}`}>{fmt(total)}</span>
      </div>
      <datalist id={listId}>
        {labelOptions.map(l => <option key={l} value={l}/>)}
      </datalist>
      <div className="space-y-2">
        {items.map(item => (
          <div key={item.id} className="flex items-center gap-2">
            <input type="text" list={listId} value={item.label} onChange={e => update(item.id, { label: e.target.value })}
              placeholder="項目名（仕入れ先・品目など）"
              className="flex-1 text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-300"/>
            <NumberInput value={item.amount} onChange={v => update(item.id, { amount: v })}
              className="w-28 text-right text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-300"/>
            <button onClick={() => remove(item.id)} className="text-gray-300 hover:text-red-500 shrink-0"><X size={14}/></button>
          </div>
        ))}
        {items.length === 0 && <div className="text-xs text-gray-300">なし</div>}
      </div>
      <button onClick={add} className="text-xs text-gray-600 mt-2 flex items-center gap-1 hover:text-gray-800">
        <Plus size={12}/> 行を追加
      </button>
    </div>
  )
}

export default function DailyEntry() {
  const { reports, staff, loadReports, loadStaff, saveReport, loadSettings, selectedDate, setSelectedDate, setPage } = useAppStore()
  const [showBulkImport, setShowBulkImport] = useState(false)
  const [viewMode, setViewMode] = useState<'input' | 'list'>('input')

  useEffect(() => { loadReports(); loadStaff(); loadSettings() }, [])

  const report: BalanceReport = reports[selectedDate] ?? defaultReport(selectedDate)
  const month = selectedDate.slice(0, 7)

  const sales = report.cash.sales
  const shifts = report.shifts
  const labor = sumShiftPay(shifts)
  const ingredientItems = report.corp.withdraws.filter(w => w.category === 'ingredient')
  const suppliesItems = report.corp.withdraws.filter(w => w.category === 'supplies')
  const otherItems = report.corp.withdraws.filter(w => w.category === 'other')
  const ingredient = sumItems(ingredientItems)
  const supplies = sumItems(suppliesItems)
  const other = sumItems(otherItems)
  const profit = sales - labor - ingredient - supplies - other

  const monthPL = useMemo(() => calcPL(reports, month), [reports, month])
  const ingredientLabels = useMemo(() => usedLabels(reports, 'ingredient'), [reports])
  const suppliesLabels = useMemo(() => usedLabels(reports, 'supplies'), [reports])
  const otherLabels = useMemo(() => usedLabels(reports, 'other'), [reports])

  const changeDate = (delta: number) => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + delta)
    setSelectedDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  const changeMonth = (delta: number) => {
    const d = new Date(selectedDate)
    d.setMonth(d.getMonth() + delta, 1)
    setSelectedDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`)
  }

  const updateSales = (v: number) => saveReport({ ...report, cash: { ...report.cash, sales: v } })
  const updateCategoryItems = (category: ExpenseCategory, items: LineItem[]) => {
    const rest = report.corp.withdraws.filter(w => w.category !== category)
    saveReport({ ...report, corp: { ...report.corp, withdraws: [...rest, ...items] } })
  }

  const saveShifts = (next: ShiftEntry[]) => saveReport(applyShiftsToReport(report, next))
  const addShift = () => saveShifts([...shifts, newShiftEntry()])
  const updateShift = (id: string, patch: Partial<ShiftEntry>) =>
    saveShifts(shifts.map(s => (s.id === id ? { ...s, ...patch } : s)))
  const removeShift = (id: string) => saveShifts(shifts.filter(s => s.id !== id))

  const onPickStaff = (id: string, name: string) => {
    const member = staff.find(s => s.name === name)
    updateShift(id, member
      ? { staffName: name, hourlyWage: member.hourlyWage, transport: member.transport }
      : { staffName: name })
  }

  const dayOfWeek = getDayOfWeek(selectedDate)
  const weekend = isWeekend(selectedDate)
  const profitable = profit >= 0
  const monthProfitable = monthPL.profit >= 0

  return (
    <div className={`p-6 ${viewMode === 'list' ? 'max-w-3xl' : 'max-w-2xl'}`}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          {viewMode === 'input' && (
            <button onClick={() => changeDate(-1)} className="p-1.5 rounded hover:bg-gray-200 transition"><ChevronLeft size={20}/></button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              {viewMode === 'input'
                ? <>{selectedDate}<span className={`ml-2 text-lg ${weekend ? 'text-red-500' : 'text-gray-400'}`}>({dayOfWeek})</span></>
                : 'シフト一覧'}
            </h1>
            <p className="text-gray-400 text-sm">日次入力 ／ 売上・人件費・仕入だけを入力して損益を出す</p>
          </div>
          {viewMode === 'input' && (
            <>
              <button onClick={() => changeDate(1)} className="p-1.5 rounded hover:bg-gray-200 transition"><ChevronRight size={20}/></button>
              <input type="date" value={selectedDate} onChange={e => e.target.value && setSelectedDate(e.target.value)}
                title="日付を直接指定してジャンプ"
                className="text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"/>
            </>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setViewMode('input')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${viewMode === 'input' ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
            <Pencil size={14}/> 入力
          </button>
          <button onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${viewMode === 'list' ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
            <List size={14}/> シフト一覧
          </button>
        </div>
      </div>

      {viewMode === 'list' ? (
        <ShiftList reports={reports} month={month} onChangeMonth={changeMonth}
          onEditDate={(date) => { setSelectedDate(date); setViewMode('input') }}/>
      ) : (
      <>
      <div className={`card border-l-4 mb-6 ${profitable ? 'border-green-500' : 'border-red-500'}`}>
        <div className="card-header flex items-center gap-1 mb-2">
          {profitable ? <TrendingUp size={12}/> : <TrendingDown size={12}/>} 本日のまとめ
        </div>
        <div className="space-y-1.5 text-sm mb-3">
          <div className="flex justify-between"><span className="text-gray-500">売上</span><span className="font-bold text-blue-700">{fmt(sales)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">人件費</span><span className="font-bold text-purple-700">-{fmt(labor)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">経費（食材＋備品＋その他）</span><span className="font-bold text-orange-700">-{fmt(ingredient + supplies + other)}</span></div>
        </div>
        <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
          <span className="text-sm font-bold text-gray-600">当日損益</span>
          <span className={`text-3xl font-black ${profitable ? 'text-green-600' : 'text-red-600'}`}>
            {profitable ? '+' : ''}{fmt(profit)}
          </span>
        </div>
      </div>

      <button onClick={() => setPage('pl')}
        className={`card w-full text-left border-l-4 mb-6 ${monthProfitable ? 'border-green-500' : 'border-red-500'} hover:bg-gray-50 transition flex items-center justify-between`}>
        <div>
          <div className="card-header flex items-center gap-1"><BarChart3 size={12}/> {month.replace('-', '年')}月の累計損益</div>
          <div className={`text-2xl font-black ${monthProfitable ? 'text-green-600' : 'text-red-600'}`}>
            {monthProfitable ? '+' : ''}{fmt(monthPL.profit)}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            売上 {fmt(monthPL.revenueTotal)} − 費用 {fmt(monthPL.expenseTotal)} ／ {monthPL.daysWithData}日分・損益表で詳細を見る
          </div>
        </div>
      </button>

      <div className="card mb-6">
        <BigInput label="売上" value={sales} onChange={updateSales} color="text-blue-700"/>
      </div>

      {/* 出勤スタッフ・人件費 */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5 text-sm font-bold text-purple-700">
            <Users size={16}/> 出勤スタッフ・人件費
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowBulkImport(true)}
              className="flex items-center gap-1 text-xs text-purple-600 border border-purple-200 rounded px-2 py-1 hover:bg-purple-50">
              <ClipboardPaste size={12}/> 貼り付けで一括登録
            </button>
            <span className="text-lg font-black text-purple-700">{fmt(labor)}</span>
          </div>
        </div>
        <div className="space-y-2">
          {shifts.map(s => {
            const hours = calcShiftHours(s.clockIn, s.clockOut)
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-2 border-b border-gray-50 pb-2 last:border-0">
                <select value={s.staffName} onChange={e => onPickStaff(s.id, e.target.value)}
                  className="w-28 text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-300">
                  <option value="">名前を選択</option>
                  {staff.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
                <input type="time" value={s.clockIn} onChange={e => updateShift(s.id, { clockIn: e.target.value })}
                  className="text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-300"/>
                <span className="text-xs text-gray-400">〜</span>
                <input type="time" value={s.clockOut} onChange={e => updateShift(s.id, { clockOut: e.target.value })}
                  className="text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-300"/>
                <span className="text-xs text-gray-400 w-16 shrink-0">{hours > 0 ? fmtHours(hours) : '-'}</span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-400">交通費</span>
                  <NumberInput value={s.transport} onChange={v => updateShift(s.id, { transport: v })}
                    className="w-16 text-right text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-purple-300"/>
                </div>
                <span className="text-sm font-bold text-gray-700 w-20 text-right shrink-0 ml-auto">{fmtShort(shiftPay(s))}</span>
                <button onClick={() => removeShift(s.id)} className="text-gray-300 hover:text-red-500 shrink-0"><X size={14}/></button>
              </div>
            )
          })}
          {shifts.length === 0 && <div className="text-xs text-gray-300">出勤者なし</div>}
        </div>
        <button onClick={addShift} className="text-xs text-purple-600 mt-2 flex items-center gap-1 hover:text-purple-800">
          <Plus size={12}/> 枠を追加
        </button>
      </div>

      <QuickItemsCard title="仕入れ（食材）" color="text-red-700" category="ingredient"
        items={ingredientItems} labelOptions={ingredientLabels} onChange={items => updateCategoryItems('ingredient', items)}/>
      <QuickItemsCard title="仕入れ（備品）" color="text-orange-700" category="supplies"
        items={suppliesItems} labelOptions={suppliesLabels} onChange={items => updateCategoryItems('supplies', items)}/>

      <div className="flex items-center justify-between px-1 mb-6 -mt-3">
        <span className="text-xs font-bold text-gray-500">仕入れ合計（食材＋備品）</span>
        <span className="text-sm font-black text-gray-700">{fmt(ingredient + supplies)}</span>
      </div>

      <QuickItemsCard title="その他経費（家賃・光熱費・ATM手数料など）" color="text-gray-600" category="other"
        items={otherItems} labelOptions={otherLabels} onChange={items => updateCategoryItems('other', items)}/>

      {showBulkImport && <ShiftBulkImportModal onClose={() => setShowBulkImport(false)}/>}
      </>
      )}
    </div>
  )
}
