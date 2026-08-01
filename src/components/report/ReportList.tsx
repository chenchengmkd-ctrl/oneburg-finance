import { useState } from 'react'
import { fmt, fmtShort, getDayOfWeek, isWeekend } from '../../utils/calculations'
import { buildReportText } from '../../utils/reportCalc'
import type { ReportDay } from '../../types'
import { Copy, Check, Pencil } from 'lucide-react'

export default function ReportList({ series, onEdit }: {
  series: ReportDay[]
  onEdit: (date: string) => void
}) {
  const [copiedDate, setCopiedDate] = useState<string | null>(null)
  const rows = [...series].reverse()

  const copy = async (day: ReportDay) => {
    await navigator.clipboard.writeText(buildReportText(day))
    setCopiedDate(day.date)
    setTimeout(() => setCopiedDate(d => (d === day.date ? null : d)), 2000)
  }

  if (rows.length === 0) {
    return <div className="card text-center py-12 text-gray-400 text-sm">まだ残高報告がありません</div>
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-gray-400 text-xs">
            <th className="text-left py-2 pr-3">日付</th>
            <th className="text-right pr-3">GMO個人</th>
            <th className="text-right pr-3">GMO法人</th>
            <th className="text-right pr-3">現金</th>
            <th className="text-right pr-3">残高合計</th>
            <th className="text-right pr-3">実質総資産</th>
            <th className="text-right pr-3">前日比</th>
            <th className="text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const prev = rows[i + 1]
            const diff = prev ? s.realBal - prev.realBal : null
            const weekend = isWeekend(s.date)
            return (
              <tr key={s.date} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-1.5 pr-3">
                  <span className="text-gray-700">{s.date}</span>
                  <span className={`ml-1 text-xs ${weekend ? 'text-red-400' : 'text-gray-300'}`}>({getDayOfWeek(s.date)})</span>
                </td>
                <td className="text-right pr-3 text-green-700">{fmtShort(s.persBal)}</td>
                <td className="text-right pr-3 text-blue-700">{fmtShort(s.corpBal)}</td>
                <td className="text-right pr-3 text-amber-700">{fmtShort(s.cashBal)}</td>
                <td className="text-right pr-3 font-bold text-gray-700">{fmtShort(s.totalBal)}</td>
                <td className="text-right pr-3 font-bold text-gray-900">{fmtShort(s.realBal)}</td>
                <td className={`text-right pr-3 font-bold ${diff === null ? 'text-gray-300' : diff >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {diff === null ? '-' : `${diff >= 0 ? '+' : ''}${fmtShort(diff)}`}
                </td>
                <td className="text-right">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => copy(s)} title="報告テキストをコピー"
                      className="text-gray-400 hover:text-blue-600 transition">
                      {copiedDate === s.date ? <Check size={15} className="text-green-600"/> : <Copy size={15}/>}
                    </button>
                    <button onClick={() => onEdit(s.date)} title="この日を編集"
                      className="text-gray-400 hover:text-blue-600 transition">
                      <Pencil size={15}/>
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="text-xs text-gray-400 mt-3 px-1">{rows.length}日分 ／ 実質総資産合計: {fmt(rows[0]?.realBal ?? 0)}（最新日）</div>
    </div>
  )
}
