import { useEffect, useState } from 'react'
import { useAppStore } from '../stores/appStore'
import { fmt, fmtShort, fmtHours, getDayOfWeek, isWeekend } from '../utils/calculations'
import {
  defaultReport, newShiftEntry, sumNet, sumShiftPay, calcShiftHours,
  usedLabelDefs, usedVendors, applyShiftsToReport, salesTaxRateOf, toNet,
} from '../utils/storage'
import type { BalanceReport, ExpenseCategory, LineItem, ShiftEntry, TaxRate } from '../types'
import NumberInput from '../components/common/NumberInput'
import TaxAmountInput from '../components/common/TaxAmountInput'
import ExpenseInput from '../components/common/ExpenseInput'
import { ChevronLeft, ChevronRight, Plus, X, RefreshCw, Users, Receipt } from 'lucide-react'

// 日次入力。売上（Square自動）と人件費（LINE勤怠ボット自動）は結果の確認だけにし、
// 毎日の手入力は経費だけで済むようにしている（2026-09の画面刷新）

// 自動で入る数字（売上・人件費）の1行。ふだんは結果だけ見せ、「直す」を押したときだけ編集欄を出す
function AutoRow({ icon: Icon, label, amount, source, color, open, onToggle, children }: {
  icon: React.ElementType; label: string; amount: number; source: string; color: string
  open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div className="border-b border-gray-100 last:border-0 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-sm text-gray-600">
          <Icon size={14} className="text-gray-300"/> {label}
        </span>
        <span className="flex items-baseline gap-2">
          <span className={`text-lg font-black ${color}`}>{fmt(amount)}</span>
          <button onClick={onToggle} className="text-[11px] text-gray-400 hover:text-gray-600 underline shrink-0">
            {open ? '閉じる' : '直す'}
          </button>
        </span>
      </div>
      <div className="text-[11px] text-gray-400 mt-0.5">{source}</div>
      {open && <div className="mt-3">{children}</div>}
    </div>
  )
}

export default function Entry() {
  const {
    reports, staff, itemLabels, selectedDate,
    loadReports, loadStaff, loadItemLabels, saveReport, setSelectedDate, setPage,
  } = useAppStore()
  const [editSales, setEditSales] = useState(false)
  const [editShifts, setEditShifts] = useState(false)

  useEffect(() => { loadReports(); loadStaff(); loadItemLabels() }, [])

  const report: BalanceReport = reports[selectedDate] ?? defaultReport(selectedDate)

  // 損益は税抜ベースで見る（消費税は預かり金・仮払金であって儲けではない）。
  // 保存値は税込のままなので、資金繰り・残高は実際に動いたお金と一致する
  const sales = report.cash.sales
  const salesRate = salesTaxRateOf(report.cash)
  const salesNet = toNet(sales, salesRate)
  const shifts = report.shifts
  const labor = sumShiftPay(shifts)
  const pick = (c: ExpenseCategory) => report.corp.withdraws.filter(w => w.category === c)
  const ingredientItems = pick('ingredient')
  const suppliesItems = pick('supplies')
  const otherItems = pick('other')
  const expenseNet = sumNet(ingredientItems) + sumNet(suppliesItems) + sumNet(otherItems)
  const profit = salesNet - labor - expenseNet

  // 矢印を連打しても1回分しか進まないことがないよう、毎回ストアの最新日付を読み直す
  const changeDate = (delta: number) => {
    const d = new Date(useAppStore.getState().selectedDate)
    d.setDate(d.getDate() + delta)
    setSelectedDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }

  // 保存は必ず「読み込んだreportをそのまま持ち回り、必要なところだけ差し替える」形にする。
  // LINEボットと勤怠アプリが同じJSONを丸ごと書き戻すので、こちらが知らないフィールドを落とすと消えてしまう
  const updateSales = (v: number) => saveReport({ ...report, cash: { ...report.cash, sales: v } })
  const updateSalesRate = (r: TaxRate) => saveReport({ ...report, cash: { ...report.cash, salesTaxRate: r } })
  const updateCategoryItems = (category: ExpenseCategory, items: LineItem[]) => {
    const rest = report.corp.withdraws.filter(w => w.category !== category)
    saveReport({ ...report, corp: { ...report.corp, withdraws: [...rest, ...items] } })
  }

  const saveShifts = (next: ShiftEntry[]) => saveReport(applyShiftsToReport(report, next))
  const updateShift = (id: string, patch: Partial<ShiftEntry>) =>
    saveShifts(shifts.map(s => (s.id === id ? { ...s, ...patch } : s)))
  const onPickStaff = (id: string, name: string) => {
    const member = staff.find(s => s.name === name)
    updateShift(id, member
      ? { staffName: name, hourlyWage: member.hourlyWage, transport: member.transport }
      : { staffName: name })
  }

  const weekend = isWeekend(selectedDate)
  const profitable = profit >= 0
  const editMaster = () => setPage('settings')

  return (
    <div className="p-4 sm:p-6 max-w-2xl">
      {/* 日付 */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => changeDate(-1)} className="p-1.5 rounded hover:bg-gray-200 transition"><ChevronLeft size={20}/></button>
        <h1 className="text-2xl font-bold text-gray-800">
          {selectedDate.slice(5).replace('-', '/')}
          <span className={`ml-1.5 text-lg ${weekend ? 'text-red-500' : 'text-gray-400'}`}>({getDayOfWeek(selectedDate)})</span>
        </h1>
        <button onClick={() => changeDate(1)} className="p-1.5 rounded hover:bg-gray-200 transition"><ChevronRight size={20}/></button>
        <input type="date" value={selectedDate} onChange={e => e.target.value && setSelectedDate(e.target.value)}
          title="日付を直接指定してジャンプ"
          className="text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 ml-auto"/>
      </div>

      {/* 自動で入っているもの */}
      <div className="card mb-4">
        <div className="flex items-center gap-1.5 mb-1">
          <RefreshCw size={13} className="text-green-600"/>
          <span className="text-sm font-bold text-green-700">自動で入っています</span>
        </div>
        <p className="text-[11px] text-gray-400 mb-1">入力は不要です。数字が違うときだけ「直す」から直してください</p>

        <AutoRow icon={Receipt} label="売上" amount={sales} color="text-blue-700"
          source="Squareのレジ売上から自動反映（税込）"
          open={editSales} onToggle={() => setEditSales(v => !v)}>
          <div className="flex items-start gap-2">
            <select value={salesRate} onChange={e => updateSalesRate(Number(e.target.value) as TaxRate)}
              title="売上の消費税率"
              className="text-xs text-gray-600 border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white">
              <option value={8}>8%（持ち帰り）</option>
              <option value={10}>10%（店内飲食）</option>
              <option value={0}>非課税</option>
            </select>
            <div className="flex-1">
              {/* 税率を変えたら計算し直されるよう、税率をキーに含めて入力欄を作り直す */}
              <TaxAmountInput key={salesRate} gross={sales} rate={salesRate} onChange={updateSales}/>
            </div>
          </div>
        </AutoRow>

        <AutoRow icon={Users} label="人件費" amount={labor} color="text-purple-700"
          source="LINEの勤怠ボット（スタッフの「出勤」「退勤」）から自動反映"
          open={editShifts} onToggle={() => setEditShifts(v => !v)}>
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
                  <button onClick={() => saveShifts(shifts.filter(x => x.id !== s.id))}
                    className="text-gray-300 hover:text-red-500 ml-auto"><X size={14}/></button>
                </div>
              )
            })}
            {shifts.length === 0 && <div className="text-xs text-gray-300">まだ打刻がありません</div>}
            <button onClick={() => saveShifts([...shifts, newShiftEntry()])}
              className="text-xs text-gray-600 flex items-center gap-1 hover:text-gray-800">
              <Plus size={12}/> 枠を追加
            </button>
          </div>
        </AutoRow>
      </div>

      {/* 経費（ここだけが毎日の手入力） */}
      <p className="section-header">経費を入れる</p>
      <ExpenseInput title="食材" color="text-red-700" category="ingredient"
        items={ingredientItems} labelDefs={usedLabelDefs(reports, 'ingredient', itemLabels.items.ingredient)}
        vendorOptions={usedVendors(reports, 'ingredient', itemLabels.vendors.ingredient)}
        pinnedVendors={itemLabels.vendors.ingredient}
        hint="仕入れ先は毎日この並びで固定。品目と金額（レシートの税込）を足すだけでOK"
        onChange={items => updateCategoryItems('ingredient', items)} onEditMaster={editMaster}/>
      <ExpenseInput title="備品" color="text-orange-700" category="supplies"
        items={suppliesItems} labelDefs={usedLabelDefs(reports, 'supplies', itemLabels.items.supplies)}
        vendorOptions={usedVendors(reports, 'supplies', itemLabels.vendors.supplies)}
        pinnedVendors={itemLabels.vendors.supplies}
        onChange={items => updateCategoryItems('supplies', items)} onEditMaster={editMaster}/>
      <ExpenseInput title="その他（家賃・光熱費・手数料など）" color="text-gray-700" category="other"
        items={otherItems} labelDefs={usedLabelDefs(reports, 'other', itemLabels.items.other)}
        vendorOptions={usedVendors(reports, 'other', itemLabels.vendors.other)}
        pinnedVendors={itemLabels.vendors.other}
        onChange={items => updateCategoryItems('other', items)} onEditMaster={editMaster}/>

      {/* 今日のまとめ */}
      <div className={`card border-l-4 mb-6 ${profitable ? 'border-green-500' : 'border-red-500'}`}>
        <div className="card-header flex items-center justify-between mb-2">
          <span>この日のまとめ</span>
          <span className="text-[10px] font-normal text-gray-400">すべて税抜</span>
        </div>
        <div className="space-y-1.5 text-sm mb-3">
          <div className="flex justify-between"><span className="text-gray-500">売上</span><span className="font-bold text-blue-700">{fmt(salesNet)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">人件費</span><span className="font-bold text-purple-700">-{fmt(labor)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">経費</span><span className="font-bold text-orange-700">-{fmt(expenseNet)}</span></div>
        </div>
        <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
          <span className="text-sm font-bold text-gray-600">この日の利益</span>
          <span className={`text-3xl font-black ${profitable ? 'text-green-600' : 'text-red-600'}`}>
            {profitable ? '+' : ''}{fmt(profit)}
          </span>
        </div>
        <div className="text-[11px] text-gray-400 text-right mt-1">税込では売上 {fmtShort(sales)}</div>
      </div>
    </div>
  )
}
