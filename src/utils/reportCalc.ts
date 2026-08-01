import type { BalanceReport, ReportDay, ReportPending, LineItem } from '../types'
import { sumItems } from './storage'

const num = (n: number) => new Intl.NumberFormat('ja-JP').format(Math.round(n))
const itemNotes = (items: LineItem[]) => items.map(i => i.label).filter(Boolean).join('、')

// 残高チェーン計算：日付順に前日残を引き継いで各日の残高目安・実質総資産を算出
export const buildReportSeries = (reports: Record<string, BalanceReport>): ReportDay[] => {
  const dates = Object.keys(reports).sort()
  const out: ReportDay[] = []
  let prevPers: number | null = null
  let prevCorp: number | null = null
  let prevCash: number | null = null

  for (const date of dates) {
    const r = reports[date]
    const persPrev: number = r.pers.prevOverride ?? prevPers ?? 0
    const corpPrev: number = r.corp.prevOverride ?? prevCorp ?? 0
    const cashPrev: number = r.cash.prevOverride ?? prevCash ?? 0

    const persDeposit = sumItems(r.pers.deposits)
    const persWithdraw = sumItems(r.pers.withdraws)
    const corpDeposit = sumItems(r.corp.deposits)
    const corpWithdraw = sumItems(r.corp.withdraws)
    const cashDeposit = sumItems(r.cash.deposits)
    const cashWithdraw = sumItems(r.cash.withdraws)

    const persBal: number = r.pers.balanceOverride ?? (persPrev + persDeposit - persWithdraw)
    // 現金からの銀行入金は法人口座へ自動反映
    const corpBal: number = r.corp.balanceOverride ?? (corpPrev + corpDeposit + r.cash.toBank - corpWithdraw)
    const cashBal: number = r.cash.balanceOverride ?? (cashPrev + r.cash.sales + cashDeposit - cashWithdraw - r.cash.toBank)

    const totalBal = persBal + corpBal + cashBal
    const realBal = totalBal + r.pending.persExpected + r.pending.corpSquare - r.pending.cashReturn

    out.push({ date, persPrev, persBal, corpPrev, corpBal, cashPrev, cashBal, totalBal, realBal, report: r })

    prevPers = persBal
    prevCorp = corpBal
    prevCash = cashBal
  }
  return out
}

// 指定日より前の最新レポートのpending（新規日のデフォルト引き継ぎ用）
export const latestPendingBefore = (
  reports: Record<string, BalanceReport>,
  date: string
): ReportPending | undefined => {
  const prev = Object.keys(reports).filter(d => d < date).sort().pop()
  return prev ? { ...reports[prev].pending } : undefined
}

export const diffDays = (from: string, to: string) =>
  Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000)

// 次の日曜日（当日が日曜ならその日）
export const nextSundayStr = (dateStr: string): string => {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const monthEndStr = (dateStr: string): string => {
  const [y, m] = dateStr.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

export const tomorrowStr = (dateStr: string): string => {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 実質総資産の着地予想：直近最大8日分の傾きで線形外挿（データ2日未満はnull）
export const projectReal = (series: ReportDay[], targetDate: string): number | null => {
  if (series.length < 2) return null
  const recent = series.slice(-8)
  const first = recent[0]
  const last = recent[recent.length - 1]
  const days = diffDays(first.date, last.date)
  if (days <= 0) return null
  const perDay = (last.realBal - first.realBal) / days
  return Math.round(last.realBal + perDay * diffDays(last.date, targetDate))
}

// 毎日の報告テキストを生成（送信フォーマット準拠）
export const buildReportText = (day: ReportDay): string => {
  const r = day.report
  const [, m, d] = r.date.split('-')
  const L: string[] = []

  const persDeposit = sumItems(r.pers.deposits)
  const persWithdraw = sumItems(r.pers.withdraws)
  const corpDeposit = sumItems(r.corp.deposits)
  const corpWithdraw = sumItems(r.corp.withdraws)
  const cashWithdraw = sumItems(r.cash.withdraws)

  L.push(`${Number(m)}/${Number(d)} 残高報告`)
  L.push('')
  L.push('GMO個人')
  L.push(`昨日残：${num(day.persPrev)}`)
  L.push(`• 入金：${num(persDeposit)}`)
  if (itemNotes(r.pers.deposits)) L.push(`（${itemNotes(r.pers.deposits)}）`)
  L.push(`• 引出：${num(persWithdraw)}`)
  if (itemNotes(r.pers.withdraws)) L.push(`（${itemNotes(r.pers.withdraws)}）`)
  L.push(`• 残高目安：${num(day.persBal)}`)
  L.push(`• 入金予定：${num(r.pending.persExpected)}`)
  L.push('')
  L.push('GMO法人')
  L.push(`昨日残：${num(day.corpPrev)}`)
  L.push(`• 入金：${num(corpDeposit + r.cash.toBank)}`)
  if (itemNotes(r.corp.deposits)) L.push(`（${itemNotes(r.corp.deposits)}）`)
  L.push(`• 引出：${num(corpWithdraw)}`)
  if (itemNotes(r.corp.withdraws)) L.push(`（${itemNotes(r.corp.withdraws)}）`)
  L.push(`• 残高目安：${num(day.corpBal)}`)
  L.push(`（スクエア入金予定${num(r.pending.corpSquare)}）`)
  L.push('')
  L.push('屋台うなぎ現金（レジ金除く）')
  L.push(`• 昨日残：${num(day.cashPrev)}`)
  L.push(`• 銀行入金：${num(r.cash.toBank)}`)
  L.push(`• 本日現金売上：${num(r.cash.sales)}`)
  if (cashWithdraw > 0) {
    const note = itemNotes(r.cash.withdraws) || '出金'
    L.push(`（うち${note}${num(cashWithdraw)}のため${num(r.cash.sales - cashWithdraw)}円）`)
  }
  if (r.cash.salesNote) L.push(`（${r.cash.salesNote}）`)
  L.push(`• 残高目安：${num(day.cashBal)}`)
  L.push(`• 今後返却予定：${num(r.pending.cashReturn)}`)
  if (r.note) {
    L.push('')
    L.push(r.note)
  }
  return L.join('\n')
}
