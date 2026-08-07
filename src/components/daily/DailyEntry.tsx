import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { defaultReport, newShiftEntry, newLineItem, sumItems, sumNet, sumTax, sumShiftPay, shiftPay, calcShiftHours, usedLabelDefs, usedVendors, applyShiftsToReport, taxRateOf, toNet, toGross } from '../../utils/storage'
import { calcPL } from '../../utils/plCalc'
import { fmt, fmtShort, fmtHours, getDayOfWeek, isWeekend } from '../../utils/calculations'
import type { BalanceReport, ExpenseCategory, LineItem, ShiftEntry, LabelDef, TaxRate } from '../../types'
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, BarChart3, Plus, X, Users, ClipboardPaste, Pencil, List, CalendarRange } from 'lucide-react'
import NumberInput from '../common/NumberInput'
import ShiftBulkImportModal from './ShiftBulkImportModal'
import ShiftList from './ShiftList'
import ShiftPlanner from './ShiftPlanner'

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

// 選択肢がほぼ固まっている項目向け：普段はプルダウン選択、リストにないものだけ「＋ 新規入力」でその場で自由入力に切り替え
// 自由入力中は日本語入力（IME）の変換途中で親の再描画に巻き込まれないよう、ローカルのdraftを表示に使い確定後に親へ伝える
function PickField({ value, options, placeholder, addLabel, onChange, className }: {
  value: string; options: string[]; placeholder: string; addLabel: string; onChange: (v: string) => void; className: string
}) {
  const [customMode, setCustomMode] = useState(() => value !== '' && !options.includes(value))
  const [draft, setDraft] = useState(value)
  const composing = useRef(false)

  useEffect(() => { if (!composing.current) setDraft(value) }, [value])

  if (customMode) {
    return (
      <input type="text" value={draft} placeholder={placeholder} className={className} autoFocus
        onChange={e => {
          setDraft(e.target.value)
          if (!composing.current) onChange(e.target.value)
        }}
        onCompositionStart={() => { composing.current = true }}
        onCompositionEnd={e => {
          composing.current = false
          const v = (e.target as HTMLInputElement).value
          setDraft(v)
          onChange(v)
        }}/>
    )
  }
  return (
    <select value={value} onChange={e => {
      if (e.target.value === '__custom__') { setDraft(''); setCustomMode(true) }
      else onChange(e.target.value)
    }} className={className}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      <option value="__custom__">{addLabel}</option>
    </select>
  )
}

// 品目1行（品目名＋税抜金額＋税率）。QuickItemsCardの外に置くことで、入力のたびに作り直されてフォーカスが外れるのを防ぐ
// 入力欄は税抜だが、保存する`amount`は税込（実際に払った額）。残高・損益は税込のまま計算される
function ItemRow({ item, labelDefs, onUpdate, onRemove }: {
  item: LineItem; labelDefs: LabelDef[]
  onUpdate: (patch: Partial<LineItem>) => void; onRemove: () => void
}) {
  const rate = taxRateOf(item)
  const net = toNet(item.amount, rate)

  // 品目を選び直したらマスタの税率も引き継ぐ（税抜額は保ったまま税込を再計算）
  const pickLabel = (name: string) => {
    const def = labelDefs.find(d => d.name === name)
    const nextRate = def ? def.taxRate : rate
    onUpdate({ label: name, taxRate: nextRate, amount: toGross(net, nextRate) })
  }
  const changeRate = (nextRate: TaxRate) => onUpdate({ taxRate: nextRate, amount: toGross(net, nextRate) })

  return (
    <div className="flex items-center gap-2">
      <PickField value={item.label} options={labelDefs.map(d => d.name)} placeholder="品目を選択" addLabel="＋ 新しい品目を入力"
        onChange={pickLabel}
        className="flex-1 min-w-0 text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-300 bg-white"/>
      <select value={rate} onChange={e => changeRate(Number(e.target.value) as TaxRate)}
        title="消費税率"
        className="w-14 shrink-0 text-[11px] text-gray-500 border border-gray-200 rounded px-1 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-300 bg-white">
        <option value={8}>8%</option>
        <option value={10}>10%</option>
        <option value={0}>非課税</option>
      </select>
      <div className="w-28 shrink-0">
        <NumberInput value={net} onChange={v => onUpdate({ amount: toGross(v, rate) })}
          className="w-full text-right text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-300"/>
        <div className="text-[10px] text-gray-400 text-right mt-0.5">税込 {fmtShort(item.amount)}</div>
      </div>
      <button onClick={onRemove} className="text-gray-300 hover:text-red-500 shrink-0"><X size={14}/></button>
    </div>
  )
}

// 食材・備品などの仕入れ：仕入れ先（大区分）＞品目（中区分）＞金額（小区分）の3階層で入力
// 仕入れ先を設定しない行はグループ化せずフラットに表示（従来通りのシンプル入力も引き続き可能）
function QuickItemsCard({ title, color, category, items, labelDefs, vendorOptions, onChange, hint }: {
  title: string; color: string; category: ExpenseCategory
  items: LineItem[]; labelDefs: LabelDef[]; vendorOptions: string[]; onChange: (items: LineItem[]) => void; hint?: string
}) {
  const total = sumItems(items)
  const netTotal = sumNet(items)
  const taxTotal = sumTax(items)
  const update = (id: string, patch: Partial<LineItem>) => onChange(items.map(i => i.id === id ? { ...i, ...patch } : i))
  const remove = (id: string) => onChange(items.filter(i => i.id !== id))
  const addFlat = () => onChange([...items, newLineItem(category)])
  const addVendorGroup = () => onChange([...items, newLineItem(category, '')])
  const addToVendor = (vendor: string) => onChange([...items, newLineItem(category, vendor)])
  // vendor未設定（＝仕入れ先グループに属さない単独の品目）は対象外。`?? ''`で比較すると空名グループに巻き込まれる
  const renameVendor = (oldVendor: string, newVendor: string) =>
    onChange(items.map(i => i.vendor !== undefined && i.vendor === oldVendor ? { ...i, vendor: newVendor } : i))

  const flatItems = items.filter(i => i.vendor === undefined)
  const vendorOrder: string[] = []
  const byVendor = new Map<string, LineItem[]>()
  for (const item of items) {
    if (item.vendor === undefined) continue
    if (!byVendor.has(item.vendor)) { byVendor.set(item.vendor, []); vendorOrder.push(item.vendor) }
    byVendor.get(item.vendor)!.push(item)
  }

  const row = (item: LineItem) => (
    <ItemRow key={item.id} item={item} labelDefs={labelDefs}
      onUpdate={patch => update(item.id, patch)} onRemove={() => remove(item.id)}/>
  )

  return (
    <div className="card mb-6">
      <div className={`flex items-start justify-between ${hint ? 'mb-1' : 'mb-3'}`}>
        <span className={`text-sm font-bold ${color}`}>{title}</span>
        <div className="text-right">
          <div className={`text-lg font-black ${color}`}>{fmt(total)}</div>
          <div className="text-[10px] text-gray-400">税抜 {fmtShort(netTotal)} ＋ 消費税 {fmtShort(taxTotal)}</div>
        </div>
      </div>
      {hint && <p className="text-[11px] text-gray-400 mb-2">{hint}</p>}

      {flatItems.length > 0 && (
        <div className="space-y-2 mb-2">
          {flatItems.map(row)}
        </div>
      )}

      {vendorOrder.length > 0 && (
        <div className="space-y-2 mb-2">
          {vendorOrder.map(vendor => {
            const groupItems = byVendor.get(vendor)!
            return (
              // 仕入れ先名を打ち替えても行が作り直されないよう、キーには名前ではなく先頭の明細IDを使う
              <div key={groupItems[0].id} className="border border-gray-100 rounded-lg p-2 bg-gray-50">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <PickField value={vendor} options={vendorOptions} placeholder="仕入れ先を選択" addLabel="＋ 新しい仕入れ先を入力"
                    onChange={v => renameVendor(vendor, v)}
                    className="text-sm font-bold text-gray-700 bg-transparent border-b border-dashed border-gray-300 focus:outline-none focus:border-gray-500 flex-1"/>
                  <span className="text-xs font-black text-gray-500 shrink-0">{fmt(sumItems(groupItems))}</span>
                </div>
                <div className="space-y-1.5 pl-2">
                  {groupItems.map(row)}
                </div>
                <button onClick={() => addToVendor(vendor)} className="text-[11px] text-gray-500 mt-1.5 pl-2 flex items-center gap-1 hover:text-gray-700">
                  <Plus size={10}/> 品目を追加
                </button>
              </div>
            )
          })}
        </div>
      )}

      {flatItems.length === 0 && vendorOrder.length === 0 && <div className="text-xs text-gray-300 mb-2">なし</div>}

      <div className="flex items-center gap-4">
        <button onClick={addFlat} className="text-xs text-gray-600 flex items-center gap-1 hover:text-gray-800">
          <Plus size={12}/> 品目を追加
        </button>
        <button onClick={addVendorGroup} className="text-xs text-gray-600 flex items-center gap-1 hover:text-gray-800">
          <Plus size={12}/> 仕入れ先を追加
        </button>
      </div>
    </div>
  )
}

export default function DailyEntry() {
  const { reports, staff, itemLabels, loadReports, loadStaff, loadItemLabels, loadBudget, loadShiftPattern, saveReport, loadSettings, selectedDate, setSelectedDate, setPage } = useAppStore()
  const [showBulkImport, setShowBulkImport] = useState(false)
  const [viewMode, setViewMode] = useState<'input' | 'plan' | 'list'>('input')

  useEffect(() => { loadReports(); loadStaff(); loadSettings(); loadItemLabels(); loadBudget(); loadShiftPattern() }, [])

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
  const ingredientLabels = useMemo(() => usedLabelDefs(reports, 'ingredient', itemLabels.items.ingredient), [reports, itemLabels])
  const suppliesLabels = useMemo(() => usedLabelDefs(reports, 'supplies', itemLabels.items.supplies), [reports, itemLabels])
  const otherLabels = useMemo(() => usedLabelDefs(reports, 'other', itemLabels.items.other), [reports, itemLabels])
  const ingredientVendors = useMemo(() => usedVendors(reports, 'ingredient', itemLabels.vendors.ingredient), [reports, itemLabels])
  const suppliesVendors = useMemo(() => usedVendors(reports, 'supplies', itemLabels.vendors.supplies), [reports, itemLabels])
  const otherVendors = useMemo(() => usedVendors(reports, 'other', itemLabels.vendors.other), [reports, itemLabels])

  // 矢印を連打しても1回分しか進まないことがないよう、毎回ストアの最新日付を読み直す
  const changeDate = (delta: number) => {
    const d = new Date(useAppStore.getState().selectedDate)
    d.setDate(d.getDate() + delta)
    setSelectedDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  const changeMonth = (delta: number) => {
    const d = new Date(useAppStore.getState().selectedDate)
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
    <div className={`p-4 sm:p-6 ${viewMode === 'input' ? 'max-w-2xl' : 'max-w-3xl'}`}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          {viewMode === 'input' && (
            <button onClick={() => changeDate(-1)} className="p-1.5 rounded hover:bg-gray-200 transition"><ChevronLeft size={20}/></button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              {viewMode === 'input'
                ? <>{selectedDate}<span className={`ml-2 text-lg ${weekend ? 'text-red-500' : 'text-gray-400'}`}>({dayOfWeek})</span></>
                : viewMode === 'plan' ? 'シフト作成' : 'シフト一覧'}
            </h1>
            <p className="text-gray-400 text-sm">
              {viewMode === 'plan'
                ? '曜日パターンから1か月分のシフトを組み、人件費予算と見比べる'
                : '日次入力 ／ 売上・人件費・仕入だけを入力して損益を出す'}
            </p>
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
          <button onClick={() => setViewMode('plan')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${viewMode === 'plan' ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
            <CalendarRange size={14}/> シフト作成
          </button>
          <button onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${viewMode === 'list' ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
            <List size={14}/> シフト一覧
          </button>
        </div>
      </div>

      {viewMode === 'plan' ? (
        <ShiftPlanner month={month} onChangeMonth={changeMonth}
          onEditDate={(date) => { setSelectedDate(date); setViewMode('input') }}/>
      ) : viewMode === 'list' ? (
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
        items={ingredientItems} labelDefs={ingredientLabels} vendorOptions={ingredientVendors} onChange={items => updateCategoryItems('ingredient', items)}
        hint="「仕入れ先を追加」で肉のハナマサ等をまとめ、その中に日本酒・お米など品目ごとの金額を入れると、損益表で細かく見られます"/>
      <QuickItemsCard title="仕入れ（備品）" color="text-orange-700" category="supplies"
        items={suppliesItems} labelDefs={suppliesLabels} vendorOptions={suppliesVendors} onChange={items => updateCategoryItems('supplies', items)}/>

      <div className="flex items-center justify-between px-1 mb-6 -mt-3">
        <span className="text-xs font-bold text-gray-500">仕入れ合計（食材＋備品）</span>
        <span className="text-sm font-black text-gray-700">{fmt(ingredient + supplies)}</span>
      </div>

      <QuickItemsCard title="その他経費（家賃・光熱費・ATM手数料など）" color="text-gray-600" category="other"
        items={otherItems} labelDefs={otherLabels} vendorOptions={otherVendors} onChange={items => updateCategoryItems('other', items)}/>

      {showBulkImport && <ShiftBulkImportModal onClose={() => setShowBulkImport(false)}/>}
      </>
      )}
    </div>
  )
}
