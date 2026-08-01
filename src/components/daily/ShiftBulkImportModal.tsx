import { useMemo, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { defaultReport, isBlankShift, newShiftEntry, applyShiftsToReport, calcShiftHours, shiftPay } from '../../utils/storage'
import { parseShiftBulkText, type ParsedShiftLine } from '../../utils/shiftImport'
import { fmtShort, fmtHours, getDayOfWeek } from '../../utils/calculations'
import type { ShiftEntry } from '../../types'
import { X, AlertTriangle, Check } from 'lucide-react'

export default function ShiftBulkImportModal({ onClose }: { onClose: () => void }) {
  const { reports, staff, saveReport } = useAppStore()
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ParsedShiftLine[] | null>(null)
  const [savedCount, setSavedCount] = useState<number | null>(null)

  const unmatchedCount = useMemo(() => parsed?.filter(p => !p.matchedStaff).length ?? 0, [parsed])
  const dateCount = useMemo(() => new Set(parsed?.map(p => p.date)).size, [parsed])

  const handleParse = () => {
    setSavedCount(null)
    setParsed(parseShiftBulkText(text, staff))
  }

  const handleCommit = () => {
    if (!parsed || parsed.length === 0) return
    const byDate = new Map<string, ParsedShiftLine[]>()
    for (const line of parsed) {
      if (!byDate.has(line.date)) byDate.set(line.date, [])
      byDate.get(line.date)!.push(line)
    }
    for (const [date, lines] of byDate) {
      const report = reports[date] ?? defaultReport(date)
      const shifts: ShiftEntry[] = [...report.shifts]
      for (const line of lines) {
        const staffMember = staff.find(s => s.name === line.staffName)
        let idx = shifts.findIndex(s => s.staffName === line.staffName)
        if (idx === -1) idx = shifts.findIndex(isBlankShift)
        const base = idx >= 0 ? shifts[idx] : newShiftEntry(staffMember)
        const entry: ShiftEntry = {
          ...base,
          staffName: line.staffName,
          clockIn: line.clockIn,
          clockOut: line.clockOut,
          hourlyWage: staffMember?.hourlyWage ?? base.hourlyWage,
          transport: staffMember?.transport ?? base.transport,
        }
        if (idx >= 0) shifts[idx] = entry
        else shifts.push(entry)
      }
      saveReport(applyShiftsToReport(report, shifts))
    }
    setSavedCount(parsed.length)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">シフトを貼り付けで一括登録</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
        </div>

        {savedCount === null && (
          <>
            <p className="text-xs text-gray-500 mb-2">
              スプレッドシートの表（氏名・日付・出勤・退勤の列。曜日や行番号が混ざっていてもOK）を選択してコピーし、下に貼り付けてください。列の順番は自動で認識します。
            </p>
            <textarea value={text} onChange={e => setText(e.target.value)}
              placeholder={'上原敦子\t2026-07-02\t木\t9:25\t13:34\n都丸里帆\t2026-07-02\t木\t10:27\t14:13\n...'}
              className="w-full h-40 text-xs font-mono border border-gray-200 rounded p-2 focus:outline-none focus:ring-2 focus:ring-purple-300"/>
            <button onClick={handleParse} disabled={!text.trim()}
              className="mt-2 text-sm bg-purple-600 text-white px-4 py-1.5 rounded font-bold hover:bg-purple-700 transition disabled:opacity-30">
              解析する
            </button>

            {parsed && (
              <div className="mt-4">
                {parsed.length === 0 ? (
                  <div className="text-sm text-red-500">日付・出退勤時刻を認識できる行がありませんでした。貼り付け内容をご確認ください。</div>
                ) : (
                  <>
                    <div className="text-xs text-gray-500 mb-2">
                      {parsed.length}件のシフトを{dateCount}日分認識しました。内容を確認して登録してください。
                      {unmatchedCount > 0 && (
                        <span className="text-orange-500 font-bold ml-2">
                          <AlertTriangle size={12} className="inline mb-0.5"/> {unmatchedCount}件はスタッフ台帳の名前と一致しません（オレンジ表示）
                        </span>
                      )}
                    </div>
                    <div className="max-h-60 overflow-y-auto border border-gray-100 rounded">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr className="text-gray-400">
                            <th className="text-left px-2 py-1">日付</th>
                            <th className="text-left px-2 py-1">氏名</th>
                            <th className="text-left px-2 py-1">出勤</th>
                            <th className="text-left px-2 py-1">退勤</th>
                            <th className="text-right px-2 py-1">時間</th>
                            <th className="text-right px-2 py-1">給与</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsed.map((p, i) => {
                            const staffMember = staff.find(s => s.name === p.staffName)
                            const hours = calcShiftHours(p.clockIn, p.clockOut)
                            const pay = staffMember ? shiftPay({ id: '', staffName: p.staffName, clockIn: p.clockIn, clockOut: p.clockOut, hourlyWage: staffMember.hourlyWage, transport: staffMember.transport }) : 0
                            return (
                              <tr key={i} className={`border-t border-gray-50 ${!p.matchedStaff ? 'bg-orange-50 text-orange-600' : ''}`}>
                                <td className="px-2 py-1">{p.date}（{getDayOfWeek(p.date)}）</td>
                                <td className="px-2 py-1">{p.staffName}</td>
                                <td className="px-2 py-1">{p.clockIn}</td>
                                <td className="px-2 py-1">{p.clockOut}</td>
                                <td className="px-2 py-1 text-right">{hours > 0 ? fmtHours(hours) : '-'}</td>
                                <td className="px-2 py-1 text-right">{p.matchedStaff ? fmtShort(pay) : '-'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <button onClick={handleCommit}
                      className="mt-3 flex items-center gap-1 text-sm bg-green-600 text-white px-4 py-1.5 rounded font-bold hover:bg-green-700 transition">
                      <Check size={14}/> この内容で登録する
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {savedCount !== null && (
          <div className="text-center py-6">
            <div className="text-green-600 font-bold mb-3">{savedCount}件のシフトを登録しました。</div>
            <button onClick={onClose} className="text-sm bg-gray-700 text-white px-4 py-1.5 rounded font-bold hover:bg-gray-800 transition">
              閉じる
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
