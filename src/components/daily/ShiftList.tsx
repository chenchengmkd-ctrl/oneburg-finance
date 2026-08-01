import { useMemo } from 'react'
import { calcShiftHours, shiftPay, isBlankShift } from '../../utils/storage'
import { fmt, fmtShort, fmtHours, getDayOfWeek } from '../../utils/calculations'
import type { BalanceReport } from '../../types'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Row {
  date: string
  staffName: string
  clockIn: string
  clockOut: string
  hours: number
  pay: number
}

// 指定月の出勤シフトを日付順に並べた一覧（スプレッドシートから取り込んだ出退勤の確認用）
export default function ShiftList({ reports, month, onChangeMonth, onEditDate }: {
  reports: Record<string, BalanceReport>; month: string
  onChangeMonth: (delta: number) => void; onEditDate: (date: string) => void
}) {
  const rows: Row[] = useMemo(() => {
    const result: Row[] = []
    for (const r of Object.values(reports)) {
      if (!r.date.startsWith(month)) continue
      for (const s of r.shifts) {
        if (isBlankShift(s)) continue
        result.push({
          date: r.date,
          staffName: s.staffName || '（未入力）',
          clockIn: s.clockIn,
          clockOut: s.clockOut,
          hours: calcShiftHours(s.clockIn, s.clockOut),
          pay: shiftPay(s),
        })
      }
    }
    return result.sort((a, b) => a.date === b.date ? a.staffName.localeCompare(b.staffName, 'ja') : a.date.localeCompare(b.date))
  }, [reports, month])

  const byStaff = useMemo(() => {
    const map = new Map<string, { hours: number; pay: number; days: number }>()
    for (const row of rows) {
      const cur = map.get(row.staffName) ?? { hours: 0, pay: 0, days: 0 }
      cur.hours += row.hours; cur.pay += row.pay; cur.days += 1
      map.set(row.staffName, cur)
    }
    return [...map.entries()]
  }, [rows])

  const totalPay = rows.reduce((sum, r) => sum + r.pay, 0)

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => onChangeMonth(-1)} className="p-1.5 rounded hover:bg-gray-200 transition"><ChevronLeft size={18}/></button>
        <div className="text-lg font-bold text-gray-800">{month.replace('-', '年')}月のシフト一覧</div>
        <button onClick={() => onChangeMonth(1)} className="p-1.5 rounded hover:bg-gray-200 transition"><ChevronRight size={18}/></button>
      </div>

      {byStaff.length > 0 && (
        <div className="card mb-4">
          <div className="card-header">スタッフ別集計</div>
          <div className="space-y-1">
            {byStaff.map(([name, v]) => (
              <div key={name} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
                <span className="font-bold text-gray-700 w-24 truncate">{name}</span>
                <span className="text-xs text-gray-400">{v.days}日・{fmtHours(v.hours)}</span>
                <span className="font-bold text-purple-700">{fmt(v.pay)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between text-sm pt-2 mt-1 border-t border-gray-100 font-black text-gray-800">
              <span>合計</span>
              <span>{fmt(totalPay)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400 border-b border-gray-100">
              <th className="text-left py-1.5 pr-2">日付</th>
              <th className="text-left py-1.5 pr-2">氏名</th>
              <th className="text-left py-1.5 pr-2">出勤</th>
              <th className="text-left py-1.5 pr-2">退勤</th>
              <th className="text-right py-1.5 pr-2">時間</th>
              <th className="text-right py-1.5">日給</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 cursor-pointer" onClick={() => onEditDate(r.date)}>
                <td className="py-1.5 pr-2 text-gray-600 whitespace-nowrap">{r.date.slice(5)}（{getDayOfWeek(r.date)}）</td>
                <td className="py-1.5 pr-2 font-bold text-gray-700">{r.staffName}</td>
                <td className="py-1.5 pr-2 text-gray-500">{r.clockIn || '-'}</td>
                <td className="py-1.5 pr-2 text-gray-500">{r.clockOut || '-'}</td>
                <td className="py-1.5 pr-2 text-right text-gray-500 whitespace-nowrap">{r.hours > 0 ? fmtHours(r.hours) : '-'}</td>
                <td className="py-1.5 text-right font-bold text-gray-700">{fmtShort(r.pay)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="text-center text-xs text-gray-300 py-6">この月のシフトはまだありません</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
