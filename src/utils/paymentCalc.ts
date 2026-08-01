import type { ScheduledPayment } from '../types'

const toDateStr = (y: number, m: number, d: number) => {
  const clamped = Math.min(d, new Date(y, m + 1, 0).getDate())
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`
}

export const diffDays = (from: string, to: string) =>
  Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000)

// 次回の発生日を計算（fixed/variableはdayOfMonthから毎月算出、adhocはdueDateそのまま）
export const nextOccurrence = (payment: ScheduledPayment, fromDate: string): string | null => {
  if (payment.category === 'adhoc') return payment.dueDate

  if (payment.dayOfMonth == null) return null
  const [fy, fm] = fromDate.split('-').map(Number)
  let candidate = toDateStr(fy, fm - 1, payment.dayOfMonth)
  if (candidate < fromDate) {
    candidate = fm === 12 ? toDateStr(fy + 1, 0, payment.dayOfMonth) : toDateStr(fy, fm, payment.dayOfMonth)
  }
  return candidate
}

export interface UpcomingItem {
  payment: ScheduledPayment
  date: string | null   // null = 未定（adhocでdueDate未設定）
  overdue: boolean
}

// 指定期間内（fromDate〜fromDate+days）の支払い予定一覧。期限切れadhocは先頭にoverdueとして含む
export const upcomingPayments = (
  payments: ScheduledPayment[],
  fromDate: string,
  days: number
): UpcomingItem[] => {
  const toDate = new Date(fromDate)
  toDate.setDate(toDate.getDate() + days)
  const toDateStr2 = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}-${String(toDate.getDate()).padStart(2, '0')}`

  const items: UpcomingItem[] = []
  for (const p of payments) {
    if (!p.active) continue
    const next = nextOccurrence(p, fromDate)
    if (next === null) {
      if (p.category === 'adhoc') items.push({ payment: p, date: null, overdue: false })
      continue
    }
    const overdue = p.category === 'adhoc' && next < fromDate
    if (overdue || (next >= fromDate && next <= toDateStr2)) {
      items.push({ payment: p, date: next, overdue })
    }
  }
  return items.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
    if (a.date === null) return 1
    if (b.date === null) return -1
    return a.date.localeCompare(b.date)
  })
}

// 指定月内に発生する支払い予定の合計（月次CFの目安）
export const monthlyExpectedTotal = (payments: ScheduledPayment[], month: string): number => {
  return payments
    .filter(p => p.active)
    .reduce((sum, p) => {
      if (p.category === 'adhoc') {
        return sum + (p.dueDate && p.dueDate.startsWith(month) ? p.amount : 0)
      }
      return sum + (p.dayOfMonth != null ? p.amount : 0)
    }, 0)
}

// バケット別の内訳合計
export const totalByBucket = (items: UpcomingItem[]) => {
  const out = { corp: 0, pers: 0, cash: 0 }
  for (const it of items) {
    if (it.date === null) continue
    out[it.payment.bucket] += it.payment.amount
  }
  return out
}

export const byDirection = (items: UpcomingItem[], direction: 'in' | 'out') =>
  items.filter(it => it.payment.direction === direction)

// 収入予定合計・支出予定合計・差額（収入−支出。マイナス=資金ショートの可能性）
export const netCashflow = (items: UpcomingItem[]) => {
  const income = byDirection(items, 'in').filter(it => it.date !== null).reduce((s, it) => s + it.payment.amount, 0)
  const expense = byDirection(items, 'out').filter(it => it.date !== null).reduce((s, it) => s + it.payment.amount, 0)
  return { income, expense, net: income - expense }
}
