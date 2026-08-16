import type { BalanceReport, CashflowRecord, CfPlan, PlannedExpense } from '../types'
import { WD_JP } from './calculations'

// 週次CF（資金繰り）の日別見込み。損益ではなく「いつ・いくら現金が動くか」を見るためのものなので、
// 金額はすべて税込（＝実際に動くお金）で扱う。

export const emptyCfPlan = (): CfPlan => ({
  partTimeCount: 0,
  partTimeAmount: 0,
  unagiPerWeek: 1,
  unagiAmount: 0,
  planned: {},
})

/** 保存済みの値と既定値をマージする（項目が増えても古いデータが壊れないように） */
export const migrateCfPlan = (raw: unknown): CfPlan => {
  const r = (raw ?? {}) as Partial<CfPlan>
  return { ...emptyCfPlan(), ...r, planned: r.planned ?? {} }
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const addDays = (d: Date, n: number) => {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

/** 指定日を含む週の月曜日。カレンダーは月曜はじまりで並べる */
export const mondayOf = (dateIso: string): string => {
  const d = new Date(dateIso)
  return iso(addDays(d, d.getDay() === 0 ? -6 : 1 - d.getDay()))
}

/** 翌週の月曜日。日曜に見れば「明日から」、平日に見れば「次の月曜から」になる */
export const nextMonday = (dateIso: string): string => {
  const d = new Date(dateIso)
  const until = (8 - (d.getDay() || 7)) % 7 || 7
  return iso(addDays(d, until))
}

interface WeekdayAverage {
  cash: number
  noncash: number
}

/**
 * 曜日ごとの現金・現金以外の1日平均。
 * 全期間の単純平均だと土日と平日の差が消えてしまうので、曜日別に出して見込みの精度を上げる。
 * 実績が無い曜日は全体平均で埋める（週1しか開けていない曜日でも0にしない）。
 */
export const weekdayAverages = (records: CashflowRecord[]): WeekdayAverage[] => {
  const open = records.filter(r => (r.total ?? 0) > 0)
  const acc = WD_JP.map(() => ({ cash: 0, noncash: 0, days: 0 }))
  for (const r of open) {
    const a = acc[new Date(r.date).getDay()]
    a.cash += r.cash
    a.noncash += r.noncash
    a.days += 1
  }
  const overall = {
    cash: open.length > 0 ? Math.round(open.reduce((s, r) => s + r.cash, 0) / open.length) : 0,
    noncash: open.length > 0 ? Math.round(open.reduce((s, r) => s + r.noncash, 0) / open.length) : 0,
  }
  return acc.map(a => a.days > 0
    ? { cash: Math.round(a.cash / a.days), noncash: Math.round(a.noncash / a.days) }
    : overall)
}

export interface FixedCost {
  name: string
  day: number      // 毎月の支払日
  amount: number
}

/**
 * 履歴から「毎月だいたい何日にいくら」の固定費を拾う（家賃・光熱費）。
 * これらは月1回まとめて出るので、日ごとの見込みに均して混ぜると実態とズレる。
 * 直近に出てきた金額と日付を採用する。
 */
export const detectFixedCosts = (reports: Record<string, BalanceReport>): FixedCost[] => {
  const keys = ['家賃', '光熱費']
  const found = new Map<string, FixedCost>()
  for (const date of Object.keys(reports).sort()) {
    const r = reports[date]
    for (const bucket of [r.corp, r.pers, r.cash]) {
      for (const w of bucket.withdraws) {
        if (!w.amount) continue
        for (const key of keys) {
          if (w.label?.includes(key)) {
            found.set(key, { name: key, day: Number(date.slice(8, 10)), amount: w.amount })
          }
        }
      }
    }
  }
  return [...found.values()]
}

export interface CfDay {
  date: string
  label: string          // 「8/18(月)」
  dow: number
  isWeekend: boolean
  cashSales: number      // 現金売上の見込み
  deposit: number        // Square入金（金曜のみ）
  fixed: FixedCost[]     // その日に来る固定費
  planned: PlannedExpense[]  // 手入力した変動支出
  income: number
  expense: number
  net: number
  cumulative: number     // その日までの累計収支
}

export interface CfWeek {
  start: string
  end: string
  days: CfDay[]
  incomeTotal: number
  expenseTotal: number
  partTime: number       // バイト収入（日付が決まらないので週合計として扱う）
  net: number
  breakevenPerDay: number  // 1日あたり必要な現金売上
}

/**
 * 金曜に振り込まれる現金以外の売上。精算期間は木曜〜翌水曜（Squareの締め）。
 * 期間内で実績がある日はその値を、まだ来ていない日は曜日平均を使う。
 */
const depositFor = (
  fridayIso: string,
  records: Record<string, CashflowRecord>,
  avgs: WeekdayAverage[],
): number => {
  const friday = new Date(fridayIso)
  let total = 0
  // 木曜（金曜の8日前）から水曜（2日前）まで
  for (let i = 8; i >= 2; i--) {
    const d = addDays(friday, -i)
    const key = iso(d)
    total += records[key]?.noncash ?? avgs[d.getDay()].noncash
  }
  return total
}

/** 1週間（月〜日）の日別キャッシュフロー見込みを組み立てる */
export const buildCfWeek = (
  startIso: string,
  cashflowRecords: Record<string, CashflowRecord>,
  reports: Record<string, BalanceReport>,
  plan: CfPlan,
): CfWeek => {
  const avgs = weekdayAverages(Object.values(cashflowRecords))
  const fixedCosts = detectFixedCosts(reports)
  const start = new Date(startIso)

  let cumulative = 0
  const days: CfDay[] = []
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i)
    const date = iso(d)
    const dow = d.getDay()

    // 実績がある日（過去分）はその値を、未来はその曜日の平均を見込みとして置く
    const actual = cashflowRecords[date]
    const cashSales = actual ? actual.cash : avgs[dow].cash
    const deposit = dow === 5 ? depositFor(date, cashflowRecords, avgs) : 0
    const fixed = fixedCosts.filter(f => f.day === d.getDate())
    const planned = plan.planned[date] ?? []

    const income = cashSales + deposit
    const expense = fixed.reduce((s, f) => s + f.amount, 0) + planned.reduce((s, p) => s + p.amount, 0)
    cumulative += income - expense

    days.push({
      date,
      label: `${d.getMonth() + 1}/${d.getDate()}(${WD_JP[dow]})`,
      dow,
      isWeekend: dow === 0 || dow === 6,
      cashSales, deposit, fixed, planned,
      income, expense, net: income - expense, cumulative,
    })
  }

  const partTime = plan.partTimeCount * plan.partTimeAmount
  const incomeTotal = days.reduce((s, d) => s + d.income, 0) + partTime
  const expenseTotal = days.reduce((s, d) => s + d.expense, 0)
  const depositTotal = days.reduce((s, d) => s + d.deposit, 0)

  // 現金売上以外の入金（Square入金・バイト）は動かせないので、
  // 残りを営業日数で割ると「毎日これだけ現金が入れば週の支払いが回る」下限になる
  const openDays = days.filter(d => d.cashSales > 0).length || 7
  const breakeven = Math.max(0, expenseTotal - depositTotal - partTime)

  return {
    start: startIso,
    end: iso(addDays(start, 6)),
    days,
    incomeTotal,
    expenseTotal,
    partTime,
    net: incomeTotal - expenseTotal,
    breakevenPerDay: Math.ceil(breakeven / openDays),
  }
}

export const newPlannedExpense = (): PlannedExpense =>
  ({ id: `pe_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name: '', amount: 0 })
