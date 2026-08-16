import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { fmt, fmtShort, todayStr } from '../../utils/calculations'
import { buildCfWeek, nextMonday, mondayOf, newPlannedExpense } from '../../utils/cashflowCalc'
import type { PlannedExpense } from '../../types'
import NumberInput from '../common/NumberInput'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'

// 変動支出の1行。カレンダー内で直接足し引きする
function PlannedRow({ item, onUpdate, onRemove }: {
  item: PlannedExpense
  onUpdate: (patch: Partial<PlannedExpense>) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input type="text" value={item.name} placeholder="内容"
        onChange={e => onUpdate({ name: e.target.value })}
        className="flex-1 min-w-0 text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-orange-300"/>
      <NumberInput value={item.amount} onChange={v => onUpdate({ amount: v })}
        className="w-20 shrink-0 text-right text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-orange-300"/>
      <button onClick={onRemove} className="text-gray-300 hover:text-red-500 shrink-0"><X size={12}/></button>
    </div>
  )
}

export default function CashflowCalendar() {
  const {
    cashflowRecords, loadCashflowRecords, reports, loadReports,
    cfPlan, loadCfPlan, saveCfPlan,
  } = useAppStore()

  const today = todayStr()
  const [weekStart, setWeekStart] = useState(() => nextMonday(today))

  useEffect(() => { loadCashflowRecords(); loadReports(); loadCfPlan() }, [])

  const week = useMemo(
    () => buildCfWeek(weekStart, cashflowRecords, reports, cfPlan),
    [weekStart, cashflowRecords, reports, cfPlan],
  )

  // 変動支出の編集。連続で触っても取りこぼさないよう、保存直前に最新のcfPlanを読み直して差分を当てる
  const patchPlanned = (date: string, apply: (cur: PlannedExpense[]) => PlannedExpense[]) => {
    const cur = useAppStore.getState().cfPlan
    const next = apply(cur.planned[date] ?? [])
    const planned = { ...cur.planned }
    if (next.length > 0) planned[date] = next
    else delete planned[date]
    saveCfPlan({ ...cur, planned })
  }

  const shiftWeek = (delta: number) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + delta * 7)
    setWeekStart(mondayOf(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`))
  }

  const positive = week.net >= 0

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="section-header mb-0">週次CF予想（カレンダー）</p>
        <div className="flex items-center gap-1">
          <button onClick={() => shiftWeek(-1)} className="p-1 rounded hover:bg-gray-200 transition"><ChevronLeft size={16}/></button>
          <button onClick={() => setWeekStart(nextMonday(today))}
            className="text-xs text-gray-500 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50">来週</button>
          <button onClick={() => shiftWeek(1)} className="p-1 rounded hover:bg-gray-200 transition"><ChevronRight size={16}/></button>
        </div>
      </div>
      <p className="text-[11px] text-gray-400 mt-1 mb-2">
        金額は税込。現金売上とSquare入金は<strong className="text-gray-500">曜日ごとの実績平均</strong>からの見込みです
        （実績がある日はその値）。家賃・光熱費は履歴から自動、それ以外の支出は各日に直接入力できます
      </p>

      {/* 週サマリー */}
      <div className={`card border-l-4 mb-3 ${positive ? 'border-green-500' : 'border-red-500'}`}>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <div className="card-header">週次収支（{week.days[0].label.slice(0, -3)}〜{week.days[6].label.slice(0, -3)}）</div>
            <div className={`text-3xl font-black ${positive ? 'text-green-600' : 'text-red-600'}`}>
              {positive ? '+' : ''}{fmt(week.net)}
            </div>
          </div>
          <div className="text-xs text-gray-500 space-y-0.5">
            <div>収入 {fmt(week.incomeTotal)}{week.partTime > 0 && `（うちバイト ${fmtShort(week.partTime)}）`}</div>
            <div>支出 {fmt(week.expenseTotal)}</div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-[11px] text-gray-400">1日あたり必要な現金売上</div>
            <div className="text-lg font-black text-gray-700">{fmt(week.breakevenPerDay)}</div>
          </div>
        </div>
      </div>

      {/* 日別カレンダー */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {week.days.map(d => {
          const isPast = d.date < today
          const isToday = d.date === today
          return (
            <div key={d.date}
              className={`card ${isToday ? 'ring-2 ring-blue-400' : ''} ${isPast ? 'opacity-70' : ''}`}>
              <div className="flex items-baseline justify-between mb-2">
                <span className={`text-sm font-bold ${d.isWeekend ? 'text-red-500' : 'text-gray-700'}`}>{d.label}</span>
                <span className={`text-sm font-black ${d.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {d.net >= 0 ? '+' : ''}{fmtShort(d.net)}
                </span>
              </div>

              <div className="space-y-0.5 text-[11px] mb-2">
                <div className="flex justify-between">
                  <span className="text-gray-400">{isPast ? '現金売上' : '現金売上（見込）'}</span>
                  <span className="text-blue-700 font-bold">{fmtShort(d.cashSales)}</span>
                </div>
                {d.deposit > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Square入金</span>
                    <span className="text-blue-700 font-bold">{fmtShort(d.deposit)}</span>
                  </div>
                )}
                {d.fixed.map(f => (
                  <div key={f.name} className="flex justify-between">
                    <span className="text-gray-400">{f.name}（固定）</span>
                    <span className="text-red-600 font-bold">-{fmtShort(f.amount)}</span>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-100 pt-2">
                <div className="text-[10px] text-gray-400 mb-1">変動支出</div>
                <div className="space-y-1">
                  {d.planned.map(p => (
                    <PlannedRow key={p.id} item={p}
                      onUpdate={patch => patchPlanned(d.date, cur => cur.map(x => x.id === p.id ? { ...x, ...patch } : x))}
                      onRemove={() => patchPlanned(d.date, cur => cur.filter(x => x.id !== p.id))}/>
                  ))}
                </div>
                <button onClick={() => patchPlanned(d.date, cur => [...cur, newPlannedExpense()])}
                  className="text-[11px] text-gray-500 mt-1 flex items-center gap-1 hover:text-gray-700">
                  <Plus size={10}/> 追加
                </button>
              </div>

              <div className="border-t border-gray-100 mt-2 pt-1.5 flex justify-between text-[11px]">
                <span className="text-gray-400">週の累計</span>
                <span className={`font-bold ${d.cumulative >= 0 ? 'text-gray-600' : 'text-red-600'}`}>
                  {d.cumulative >= 0 ? '+' : ''}{fmtShort(d.cumulative)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
