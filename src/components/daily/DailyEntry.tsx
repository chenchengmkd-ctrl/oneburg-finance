import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { defaultReport, newShiftEntry, newLineItem, sumItems, sumNet, sumTax, sumShiftPay, shiftPay, calcShiftHours, usedLabelDefs, usedVendors, applyShiftsToReport, taxRateOf, salesTaxRateOf, toNet, toGross } from '../../utils/storage'
import { calcPL } from '../../utils/plCalc'
import { fmt, fmtShort, fmtHours, getDayOfWeek, isWeekend } from '../../utils/calculations'
import type { BalanceReport, ExpenseCategory, LineItem, ShiftEntry, LabelDef, TaxRate } from '../../types'
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, BarChart3, Plus, X, Users, ClipboardPaste, Pencil, List, CalendarRange } from 'lucide-react'
import NumberInput from '../common/NumberInput'
import TaxAmountInput from '../common/TaxAmountInput'
import ShiftBulkImportModal from './ShiftBulkImportModal'
import ShiftList from './ShiftList'
import ShiftPlanner from './ShiftPlanner'

// 売上欄。税抜・税込どちらでも入力でき、税率は日ごとに選べる（持ち帰り8%／店内飲食10%）
function SalesInput({ gross, rate, onChangeAmount, onChangeRate }: {
  gross: number; rate: TaxRate; onChangeAmount: (v: number) => void; onChangeRate: (r: TaxRate) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-sm font-bold text-blue-700">売上</label>
        <select value={rate} onChange={e => onChangeRate(Number(e.target.value) as TaxRate)}
          title="売上の消費税率"
          className="text-xs text-gray-600 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white">
          <option value={8}>8%（持ち帰り）</option>
          <option value={10}>10%（店内飲食）</option>
          <option value={0}>非課税</option>
        </select>
      </div>
      {/* 税率を変えたら税抜が計算し直されるよう、税率をキーに含めて入力欄を作り直す */}
      <TaxAmountInput key={rate} gross={gross} rate={rate} onChange={onChangeAmount} size="lg"/>
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

// 品目1行（品目名＋税率＋金額）。QuickItemsCardの外に置くことで、入力のたびに作り直されてフォーカスが外れるのを防ぐ
// 金額は税抜・税込どちらからでも入力できる（レシートに税込しか書いていないことがあるため）。保存する`amount`は常に税込
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
    <div className="flex items-start gap-2">
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
      <div className="w-24 shrink-0">
        <TaxAmountInput gross={item.amount} rate={rate} onChange={amount => onUpdate({ amount })}/>
      </div>
      <button onClick={onRemove} className="text-gray-300 hover:text-red-500 shrink-0 mt-1.5"><X size={14}/></button>
    </div>
  )
}

// 仕入れ先1グループ。マスタ登録済み（pinned）の仕入れ先は名前を固定表示にし、品目の入力だけに集中できるようにする。
// マスタにない一時的な仕入れ先だけ名前を打ち替えられる
function VendorGroup({ vendor, items, pinned, vendorOptions, labelDefs, onAdd, onRename, onUpdate, onRemove }: {
  vendor: string; items: LineItem[]; pinned: boolean; vendorOptions: string[]; labelDefs: LabelDef[]
  onAdd: () => void; onRename: (v: string) => void
  onUpdate: (id: string, patch: Partial<LineItem>) => void; onRemove: (id: string) => void
}) {
  const net = sumNet(items)
  return (
    <div className={`border rounded-lg p-2 ${pinned ? 'border-gray-200 bg-white' : 'border-dashed border-gray-200 bg-gray-50'}`}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        {pinned
          ? <span className="text-sm font-bold text-gray-700 flex-1 truncate">{vendor || '（仕入れ先なし）'}</span>
          : <PickField value={vendor} options={vendorOptions} placeholder="仕入れ先を選択" addLabel="＋ 新しい仕入れ先を入力"
              onChange={onRename}
              className="text-sm font-bold text-gray-700 bg-transparent border-b border-dashed border-gray-300 focus:outline-none focus:border-gray-500 flex-1"/>}
        <span className="text-xs font-black text-gray-500 shrink-0">{net > 0 ? fmt(net) : '—'}</span>
      </div>
      {items.length > 0 && (
        <div className="space-y-1.5 pl-2">
          {items.map(item => (
            <ItemRow key={item.id} item={item} labelDefs={labelDefs}
              onUpdate={patch => onUpdate(item.id, patch)} onRemove={() => onRemove(item.id)}/>
          ))}
        </div>
      )}
      <button onClick={onAdd} className="text-[11px] text-gray-500 mt-1.5 pl-2 flex items-center gap-1 hover:text-gray-700">
        <Plus size={10}/> 品目を追加
      </button>
    </div>
  )
}

// 食材・備品などの仕入れ：仕入れ先（大区分）＞品目（中区分）＞金額（小区分）の3階層で入力
// マスタに登録した仕入れ先は毎日そのまま並ぶので、日々の入力は品目と金額を足すだけで済む
function QuickItemsCard({ title, color, category, items, labelDefs, vendorOptions, pinnedVendors, onChange, hint, onEditMaster }: {
  title: string; color: string; category: ExpenseCategory
  items: LineItem[]; labelDefs: LabelDef[]; vendorOptions: string[]; pinnedVendors: string[]
  onChange: (items: LineItem[]) => void; hint?: string; onEditMaster: () => void
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
  // マスタの仕入れ先は品目が無くても常に枠を出す。マスタに無い仕入れ先だけ後ろに続ける
  const byVendor = new Map<string, LineItem[]>()
  const adhocOrder: string[] = []
  for (const item of items) {
    if (item.vendor === undefined) continue
    if (!byVendor.has(item.vendor)) {
      byVendor.set(item.vendor, [])
      if (!pinnedVendors.includes(item.vendor)) adhocOrder.push(item.vendor)
    }
    byVendor.get(item.vendor)!.push(item)
  }

  return (
    <div className="card mb-6">
      <div className={`flex items-start justify-between ${hint ? 'mb-1' : 'mb-3'}`}>
        <span className={`text-sm font-bold ${color}`}>{title}</span>
        <div className="text-right">
          <div className={`text-lg font-black ${color}`}>{fmt(netTotal)}</div>
          <div className="text-[10px] text-gray-400">税抜 ／ 税込 {fmtShort(total)}（消費税 {fmtShort(taxTotal)}）</div>
        </div>
      </div>
      {hint && <p className="text-[11px] text-gray-400 mb-2">{hint}</p>}

      {flatItems.length > 0 && (
        <div className="space-y-2 mb-2">
          {flatItems.map(item => (
            <ItemRow key={item.id} item={item} labelDefs={labelDefs}
              onUpdate={patch => update(item.id, patch)} onRemove={() => remove(item.id)}/>
          ))}
        </div>
      )}

      <div className="space-y-2 mb-2">
        {pinnedVendors.map(vendor => (
          <VendorGroup key={vendor} vendor={vendor} items={byVendor.get(vendor) ?? []} pinned
            vendorOptions={vendorOptions} labelDefs={labelDefs}
            onAdd={() => addToVendor(vendor)} onRename={() => {}}
            onUpdate={update} onRemove={remove}/>
        ))}
        {adhocOrder.map(vendor => {
          const groupItems = byVendor.get(vendor)!
          return (
            // 名前を打ち替えても行が作り直されないよう、キーには名前ではなく先頭の明細IDを使う
            <VendorGroup key={groupItems[0].id} vendor={vendor} items={groupItems} pinned={false}
              vendorOptions={vendorOptions} labelDefs={labelDefs}
              onAdd={() => addToVendor(vendor)} onRename={v => renameVendor(vendor, v)}
              onUpdate={update} onRemove={remove}/>
          )
        })}
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <button onClick={addFlat} className="text-xs text-gray-600 flex items-center gap-1 hover:text-gray-800">
          <Plus size={12}/> 仕入れ先なしで品目を追加
        </button>
        <button onClick={addVendorGroup} className="text-xs text-gray-600 flex items-center gap-1 hover:text-gray-800">
          <Plus size={12}/> 今回だけの仕入れ先
        </button>
        <button onClick={onEditMaster} className="text-xs text-gray-400 flex items-center gap-1 hover:text-gray-600 ml-auto">
          <Pencil size={11}/> 仕入れ先を編集
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

  // 損益は税抜ベースで見る（消費税は預かり金・仮払金であって儲けではない）。
  // 保存値は税込のままなので、残高・資金繰りは実際に動いたお金と一致する
  const sales = report.cash.sales
  const salesRate = salesTaxRateOf(report.cash)
  const salesNet = toNet(sales, salesRate)
  const shifts = report.shifts
  const labor = sumShiftPay(shifts)
  const ingredientItems = report.corp.withdraws.filter(w => w.category === 'ingredient')
  const suppliesItems = report.corp.withdraws.filter(w => w.category === 'supplies')
  const otherItems = report.corp.withdraws.filter(w => w.category === 'other')
  const ingredient = sumNet(ingredientItems)
  const supplies = sumNet(suppliesItems)
  const other = sumNet(otherItems)
  const profit = salesNet - labor - ingredient - supplies - other

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
  const updateSalesRate = (r: TaxRate) => saveReport({ ...report, cash: { ...report.cash, salesTaxRate: r } })
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
  const monthProfitable = monthPL.profitNet >= 0

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
        <div className="card-header flex items-center justify-between mb-2">
          <span className="flex items-center gap-1">
            {profitable ? <TrendingUp size={12}/> : <TrendingDown size={12}/>} 本日のまとめ
          </span>
          <span className="text-[10px] font-normal text-gray-400">すべて税抜</span>
        </div>
        <div className="space-y-1.5 text-sm mb-3">
          <div className="flex justify-between"><span className="text-gray-500">売上</span><span className="font-bold text-blue-700">{fmt(salesNet)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">人件費</span><span className="font-bold text-purple-700">-{fmt(labor)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">経費（食材＋備品＋その他）</span><span className="font-bold text-orange-700">-{fmt(ingredient + supplies + other)}</span></div>
        </div>
        <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
          <span className="text-sm font-bold text-gray-600">当日損益</span>
          <span className={`text-3xl font-black ${profitable ? 'text-green-600' : 'text-red-600'}`}>
            {profitable ? '+' : ''}{fmt(profit)}
          </span>
        </div>
        <div className="text-[11px] text-gray-400 text-right mt-1">税込では売上 {fmtShort(sales)}</div>
      </div>

      <button onClick={() => setPage('pl')}
        className={`card w-full text-left border-l-4 mb-6 ${monthProfitable ? 'border-green-500' : 'border-red-500'} hover:bg-gray-50 transition flex items-center justify-between`}>
        <div>
          <div className="card-header flex items-center gap-1"><BarChart3 size={12}/> {month.replace('-', '年')}月の累計損益</div>
          <div className={`text-2xl font-black ${monthProfitable ? 'text-green-600' : 'text-red-600'}`}>
            {monthProfitable ? '+' : ''}{fmt(monthPL.profitNet)}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            税抜で 売上 {fmt(monthPL.revenueNet)} − 費用 {fmt(monthPL.expenseNet)} ／ {monthPL.daysWithData}日分・損益表で詳細を見る
          </div>
        </div>
      </button>

      <div className="card mb-6">
        <SalesInput gross={sales} rate={salesRate} onChangeAmount={updateSales} onChangeRate={updateSalesRate}/>
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
        items={ingredientItems} labelDefs={ingredientLabels} vendorOptions={ingredientVendors}
        pinnedVendors={itemLabels.vendors.ingredient} onEditMaster={() => setPage('settings')}
        onChange={items => updateCategoryItems('ingredient', items)}
        hint="仕入れ先は毎日この並びで固定されます。品目と金額を足すだけでOK（並びを変えるのは設定の仕入れ先マスタ）"/>
      <QuickItemsCard title="仕入れ（備品）" color="text-orange-700" category="supplies"
        items={suppliesItems} labelDefs={suppliesLabels} vendorOptions={suppliesVendors}
        pinnedVendors={itemLabels.vendors.supplies} onEditMaster={() => setPage('settings')}
        onChange={items => updateCategoryItems('supplies', items)}/>

      <div className="flex items-center justify-between px-1 mb-6 -mt-3">
        <span className="text-xs font-bold text-gray-500">仕入れ合計（食材＋備品・税抜）</span>
        <span className="text-sm font-black text-gray-700">{fmt(ingredient + supplies)}</span>
      </div>

      <QuickItemsCard title="その他経費（家賃・光熱費・ATM手数料など）" color="text-gray-600" category="other"
        items={otherItems} labelDefs={otherLabels} vendorOptions={otherVendors}
        pinnedVendors={itemLabels.vendors.other} onEditMaster={() => setPage('settings')}
        onChange={items => updateCategoryItems('other', items)}/>

      {showBulkImport && <ShiftBulkImportModal onClose={() => setShowBulkImport(false)}/>}
      </>
      )}
    </div>
  )
}
