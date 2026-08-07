import { useMemo, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import {
  defaultReport, newShiftEntry, newPatternEntry, shiftPay, calcShiftHours,
  isBlankShift, applyShiftsToReport, budgetFor,
} from '../../utils/storage'
import { dailyLaborTargetFor } from '../../utils/budgetCalc'
import { fmt, fmtShort, fmtHours, WD_JP } from '../../utils/calculations'
import type { ShiftEntry, ShiftPatternEntry } from '../../types'
import { ChevronLeft, ChevronRight, Plus, X, CalendarCheck, Repeat } from 'lucide-react'

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

const monthDates = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return Array.from({ length: last }, (_, i) => iso(y, m, i + 1))
}

// 曜日パターンの編集（「毎週土曜は誰が何時から」を決めておく）
function PatternEditor({ onClose }: { onClose: () => void }) {
  const { staff, shiftPattern, saveShiftPattern } = useAppStore()

  // 連続操作で取りこぼさないよう、毎回ストアの最新値を読み直してから差し替える
  const patch = (dow: number, apply: (cur: ShiftPatternEntry[]) => ShiftPatternEntry[]) => {
    const cur = useAppStore.getState().shiftPattern
    saveShiftPattern({ ...cur, [dow]: apply(cur[dow] ?? []) })
  }

  const add = (dow: number) => patch(dow, cur => [...cur, newPatternEntry(staff[0])])
  const update = (dow: number, id: string, p: Partial<ShiftPatternEntry>) =>
    patch(dow, cur => cur.map(e => e.id === id ? { ...e, ...p } : e))
  const remove = (dow: number, id: string) =>
    patch(dow, cur => cur.filter(e => e.id !== id))

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-gray-800">曜日パターン</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18}/></button>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          いつもの出勤パターンを曜日ごとに決めておくと、「パターンを適用」でひと月分のシフトを一気に作れます
        </p>

        <div className="space-y-3">
          {WD_JP.map((wd, dow) => (
            <div key={dow} className="border border-gray-100 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-bold ${dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-600'}`}>
                  {wd}曜日
                </span>
                <button onClick={() => add(dow)} className="text-xs text-purple-600 flex items-center gap-1 hover:text-purple-800">
                  <Plus size={12}/> 追加
                </button>
              </div>
              <div className="space-y-1.5">
                {(shiftPattern[dow] ?? []).map(e => (
                  <div key={e.id} className="flex flex-wrap items-center gap-2">
                    <select value={e.staffName} onChange={ev => update(dow, e.id, { staffName: ev.target.value })}
                      className="w-28 text-sm border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-purple-300">
                      <option value="">名前を選択</option>
                      {staff.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                    </select>
                    <input type="time" value={e.clockIn} onChange={ev => update(dow, e.id, { clockIn: ev.target.value })}
                      className="text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-purple-300"/>
                    <span className="text-xs text-gray-400">〜</span>
                    <input type="time" value={e.clockOut} onChange={ev => update(dow, e.id, { clockOut: ev.target.value })}
                      className="text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-purple-300"/>
                    <button onClick={() => remove(dow, e.id)} className="text-gray-300 hover:text-red-500 ml-auto">
                      <X size={14}/>
                    </button>
                  </div>
                ))}
                {(shiftPattern[dow] ?? []).length === 0 && <div className="text-xs text-gray-300">出勤なし（定休日など）</div>}
              </div>
            </div>
          ))}
        </div>

        <button onClick={onClose}
          className="w-full mt-5 bg-gray-700 text-white py-2 rounded-lg font-bold text-sm hover:bg-gray-800 transition">
          閉じる
        </button>
      </div>
    </div>
  )
}

/**
 * シフト作成。月の日付を縦に並べ、その日に誰が何時から入るかを直接編集する。
 * 予定人件費はその場で計算し、曜日別の人件費予算と比べられる。
 * 保存先は各日の BalanceReport.shifts なので、日次入力・損益表の人件費とそのまま連動する。
 */
export default function ShiftPlanner({ month, onChangeMonth, onEditDate }: {
  month: string; onChangeMonth: (delta: number) => void; onEditDate: (date: string) => void
}) {
  const { reports, staff, budget, shiftPattern, saveReport } = useAppStore()
  const [showPattern, setShowPattern] = useState(false)
  const [applying, setApplying] = useState(false)

  const dates = useMemo(() => monthDates(month), [month])
  const mb = useMemo(() => budgetFor(budget, month), [budget, month])

  const shiftsOf = (date: string) => (reports[date]?.shifts ?? []).filter(s => !isBlankShift(s))

  // 保存のたびにストアの最新値を読み直す（連続で編集しても取りこぼさないため）
  const patchShifts = (date: string, apply: (cur: ShiftEntry[]) => ShiftEntry[]) => {
    const cur = useAppStore.getState().reports
    const base = cur[date] ?? defaultReport(date)
    const list = (base.shifts ?? []).filter(s => !isBlankShift(s))
    return saveReport(applyShiftsToReport({ ...base, date }, apply(list)))
  }

  const saveShifts = (date: string, next: ShiftEntry[]) => patchShifts(date, () => next)

  const addShift = (date: string) => {
    const member = staff[0]
    const entry = { ...newShiftEntry(member), clockIn: '10:00', clockOut: '14:30' }
    patchShifts(date, cur => [...cur, entry])
  }
  const updateShift = (date: string, id: string, p: Partial<ShiftEntry>) =>
    patchShifts(date, cur => cur.map(s => s.id === id ? { ...s, ...p } : s))
  const removeShift = (date: string, id: string) =>
    patchShifts(date, cur => cur.filter(s => s.id !== id))

  const pickStaff = (date: string, id: string, name: string) => {
    const member = staff.find(m => m.name === name)
    updateShift(date, id, member
      ? { staffName: name, hourlyWage: member.hourlyWage, transport: member.transport }
      : { staffName: name })
  }

  // 曜日パターンをこの月に流し込む。既にシフトが入っている日は触らない
  const applyPattern = async () => {
    const targets = dates.filter(d => shiftsOf(d).length === 0)
      .filter(d => (shiftPattern[new Date(d).getDay()] ?? []).length > 0)
    if (targets.length === 0) {
      alert('適用できる日がありません。\n（シフトが未入力で、かつ曜日パターンが設定されている日が対象です）')
      return
    }
    if (!confirm(`${targets.length}日分にパターンを適用します。\nすでにシフトが入っている日はそのままです。`)) return

    setApplying(true)
    for (const date of targets) {
      const entries = shiftPattern[new Date(date).getDay()] ?? []
      const next: ShiftEntry[] = entries
        .filter(e => e.staffName)
        .map(e => {
          const member = staff.find(m => m.name === e.staffName)
          return {
            ...newShiftEntry(member),
            staffName: e.staffName,
            clockIn: e.clockIn,
            clockOut: e.clockOut,
          }
        })
      if (next.length > 0) await saveShifts(date, next)
    }
    setApplying(false)
  }

  const monthPlanned = dates.reduce((s, d) => s + shiftsOf(d).reduce((a, x) => a + shiftPay(x), 0), 0)
  const monthBudgetLabor = dates.reduce((s, d) => s + dailyLaborTargetFor(mb, d), 0)
  const over = monthBudgetLabor > 0 && monthPlanned > monthBudgetLabor

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={() => onChangeMonth(-1)} className="p-1.5 rounded hover:bg-gray-200 transition"><ChevronLeft size={18}/></button>
          <span className="text-lg font-bold text-gray-700">{month.replace('-', '年')}月</span>
          <button onClick={() => onChangeMonth(1)} className="p-1.5 rounded hover:bg-gray-200 transition"><ChevronRight size={18}/></button>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowPattern(true)}
            className="flex items-center gap-1 text-xs text-gray-600 border border-gray-200 rounded px-2 py-1.5 hover:bg-gray-50">
            <Repeat size={12}/> 曜日パターン
          </button>
          <button onClick={applyPattern} disabled={applying}
            className="flex items-center gap-1 text-xs bg-purple-700 text-white rounded px-3 py-1.5 font-bold hover:bg-purple-800 transition disabled:opacity-50">
            <CalendarCheck size={12}/> {applying ? '適用中…' : 'パターンを適用'}
          </button>
        </div>
      </div>

      {/* 月の予定人件費 vs 予算 */}
      <div className={`card mb-4 border-l-4 ${over ? 'border-red-500' : 'border-purple-500'}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="card-header">この月の予定人件費</div>
            <div className={`text-2xl font-black ${over ? 'text-red-600' : 'text-purple-700'}`}>{fmt(monthPlanned)}</div>
          </div>
          {monthBudgetLabor > 0 && (
            <div className="text-right text-xs">
              <div className="text-gray-400">人件費予算 {fmt(monthBudgetLabor)}</div>
              <div className={`font-bold mt-0.5 ${over ? 'text-red-600' : 'text-green-600'}`}>
                {over ? `予算超過 ${fmt(monthPlanned - monthBudgetLabor)}` : `残り ${fmt(monthBudgetLabor - monthPlanned)}`}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        {dates.map(date => {
          const dow = new Date(date).getDay()
          const list = shiftsOf(date)
          const dayPay = list.reduce((s, x) => s + shiftPay(x), 0)
          const dayBudget = dailyLaborTargetFor(mb, date)
          const dayOver = dayBudget > 0 && dayPay > dayBudget
          return (
            <div key={date} className={`card ${list.length === 0 ? 'bg-gray-50/60' : ''}`}>
              <div className="flex items-center justify-between mb-1.5">
                <button onClick={() => onEditDate(date)} className="flex items-baseline gap-2 hover:underline">
                  <span className="text-sm font-bold text-gray-700">{date.slice(8)}日</span>
                  <span className={`text-xs ${dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-400'}`}>
                    ({WD_JP[dow]})
                  </span>
                </button>
                <div className="flex items-baseline gap-2 text-xs">
                  {dayBudget > 0 && <span className="text-gray-400">予算 {fmtShort(dayBudget)}</span>}
                  <span className={`font-bold ${dayOver ? 'text-red-600' : 'text-gray-700'}`}>{fmtShort(dayPay)}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                {list.map(s => {
                  const h = calcShiftHours(s.clockIn, s.clockOut)
                  return (
                    <div key={s.id} className="flex flex-wrap items-center gap-1.5">
                      <select value={s.staffName} onChange={e => pickStaff(date, s.id, e.target.value)}
                        className="w-24 text-xs border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-purple-300">
                        <option value="">名前</option>
                        {staff.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                      </select>
                      <input type="time" value={s.clockIn} onChange={e => updateShift(date, s.id, { clockIn: e.target.value })}
                        className="text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-purple-300"/>
                      <span className="text-[10px] text-gray-400">〜</span>
                      <input type="time" value={s.clockOut} onChange={e => updateShift(date, s.id, { clockOut: e.target.value })}
                        className="text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-purple-300"/>
                      <span className="text-[10px] text-gray-400 w-14">{h > 0 ? fmtHours(h) : '-'}</span>
                      <span className="text-xs font-bold text-gray-600 ml-auto">{fmtShort(shiftPay(s))}</span>
                      <button onClick={() => removeShift(date, s.id)} className="text-gray-300 hover:text-red-500">
                        <X size={13}/>
                      </button>
                    </div>
                  )
                })}
              </div>

              <button onClick={() => addShift(date)}
                className="text-[11px] text-purple-600 mt-1.5 flex items-center gap-1 hover:text-purple-800">
                <Plus size={11}/> 出勤者を追加
              </button>
            </div>
          )
        })}
      </div>

      {showPattern && <PatternEditor onClose={() => setShowPattern(false)}/>}
    </div>
  )
}
