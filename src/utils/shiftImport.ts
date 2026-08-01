import type { Staff } from '../types'

// スプレッドシートからのコピー&ペースト（タブ区切りが基本）を解析する。
// 列の並び順は問わない（氏名・日付・曜日・出勤・退勤のどれがどこにあっても認識する）
export interface ParsedShiftLine {
  date: string        // YYYY-MM-DD
  staffName: string   // 台帳に一致すればその表記名、しなければ貼り付けた文字そのまま
  clockIn: string      // "HH:MM"
  clockOut: string     // "HH:MM"
  matchedStaff: boolean
}

const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/
const WEEKDAY_RE = /^[月火水木金土日]$/
const NUM_RE = /^\d+$/

const pad2 = (n: string | number) => String(n).padStart(2, '0')

export function parseShiftBulkText(text: string, staffList: Staff[]): ParsedShiftLine[] {
  const results: ParsedShiftLine[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    let tokens = line.split('\t').map(t => t.trim()).filter(Boolean)
    if (tokens.length < 3) tokens = line.split(/\s{2,}/).map(t => t.trim()).filter(Boolean)
    if (tokens.length < 3) tokens = line.split(/\s+/).map(t => t.trim()).filter(Boolean)

    let date = ''
    const times: string[] = []
    let name = ''

    for (const t of tokens) {
      const dm = t.match(DATE_RE)
      if (dm && !date) { date = `${dm[1]}-${pad2(dm[2])}-${pad2(dm[3])}`; continue }
      if (TIME_RE.test(t)) {
        const [h, m] = t.split(':')
        times.push(`${pad2(h)}:${pad2(m)}`)
        continue
      }
      if (WEEKDAY_RE.test(t)) continue
      if (NUM_RE.test(t)) continue
      if (!name) name = t
    }

    if (!date || times.length < 2) continue

    const staff = staffList.find(s => s.name === name)
      ?? staffList.find(s => name && (s.name.includes(name) || name.includes(s.name)))

    results.push({
      date,
      staffName: staff?.name ?? name,
      clockIn: times[0],
      clockOut: times[1],
      matchedStaff: !!staff,
    })
  }

  return results.sort((a, b) => a.date.localeCompare(b.date))
}
