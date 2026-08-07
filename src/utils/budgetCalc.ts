import type { BalanceReport, BudgetSet, ExpenseCategory, MonthBudget } from '../types'
import { EXPENSE_CATEGORY_LABEL } from '../types'
import { budgetFor } from './storage'
import { calcPL } from './plCalc'

const ALL_CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABEL) as ExpenseCategory[]

export interface BudgetLine {
  category: ExpenseCategory
  label: string
  actual: number      // 実績（税込）
  budget: number      // 予算（税込）
  diff: number        // 予算 − 実績（プラスなら予算内、マイナスなら超過）
  rate: number | null // 消化率（実績/予算）。予算未設定ならnull
}

export interface BudgetResult {
  month: string
  hasBudget: boolean        // 予算が1つでも設定されているか
  elapsedDays: number       // 月内の経過日数（当月なら今日まで、過去月なら月の日数）
  totalDays: number         // その月の日数
  paceRate: number          // 経過率 = elapsedDays / totalDays（0〜1）

  revenueActual: number
  revenueBudget: number
  revenueRate: number | null   // 達成率
  revenueDiff: number          // 実績 − 目標（プラスなら目標超え）

  expenseLines: BudgetLine[]
  expenseActual: number
  expenseBudget: number
  expenseRate: number | null

  profitActual: number
  profitBudget: number         // 売上目標 − 費用予算合計
  profitDiff: number           // 実績 − 目標

  dailyRevenueTarget: number   // 1日あたり売上目標（未設定なら月次目標÷日数）
}

const daysInMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** その月に各曜日が何日あるか（index 0=日 … 6=土） */
export const weekdayCounts = (month: string): number[] => {
  const [y, m] = month.split('-').map(Number)
  const counts = [0, 0, 0, 0, 0, 0, 0]
  const total = daysInMonth(month)
  for (let d = 1; d <= total; d++) counts[new Date(y, m - 1, d).getDay()]++
  return counts
}

const hasWeek = (arr: number[] | undefined) => Array.isArray(arr) && arr.some(v => v > 0)

/** 曜日別が入っていれば「曜日別 × その月の該当曜日数」、無ければ月次の値をそのまま使う */
const monthlyFromWeek = (week: number[] | undefined, fallback: number, month: string) => {
  if (!hasWeek(week)) return fallback
  const counts = weekdayCounts(month)
  return week!.reduce((s, v, i) => s + v * counts[i], 0)
}

/** 指定日の売上目標（曜日別 → 1日目標 → 月次÷日数 の優先順） */
export const dailyRevenueTargetFor = (budget: MonthBudget, dateIso: string): number => {
  const dow = new Date(dateIso).getDay()
  if (hasWeek(budget.weekdayRevenue) && budget.weekdayRevenue[dow] > 0) return budget.weekdayRevenue[dow]
  if (budget.dailyRevenue > 0) return budget.dailyRevenue
  const month = dateIso.slice(0, 7)
  const total = daysInMonth(month)
  return budget.revenue > 0 && total > 0 ? Math.round(budget.revenue / total) : 0
}

/** 指定日の人件費予算（曜日別 → 月次÷日数 の優先順） */
export const dailyLaborTargetFor = (budget: MonthBudget, dateIso: string): number => {
  const dow = new Date(dateIso).getDay()
  if (hasWeek(budget.weekdayLabor) && budget.weekdayLabor[dow] > 0) return budget.weekdayLabor[dow]
  const month = dateIso.slice(0, 7)
  const total = daysInMonth(month)
  const plan = budget.expenses.labor ?? 0
  return plan > 0 && total > 0 ? Math.round(plan / total) : 0
}

// 当月なら今日の日付、過去月ならその月の日数、未来月なら0
const elapsedDaysOf = (month: string, todayIso: string) => {
  const total = daysInMonth(month)
  const nowMonth = todayIso.slice(0, 7)
  if (month < nowMonth) return total
  if (month > nowMonth) return 0
  return Math.min(total, Number(todayIso.slice(8, 10)))
}

export const hasAnyBudget = (b: MonthBudget) =>
  b.revenue > 0 || b.dailyRevenue > 0 || hasWeek(b.weekdayRevenue) || hasWeek(b.weekdayLabor) ||
  ALL_CATEGORIES.some(c => (b.expenses[c] ?? 0) > 0)

/**
 * 予実を計算する。実績は損益表（calcPL）と同じ集計を使うので、必ず損益表の数字と一致する。
 * 予算は税込（実績と同じ土俵）で持つ。
 */
export const calcBudget = (
  reports: Record<string, BalanceReport>,
  budgetSet: BudgetSet,
  month: string,
  todayIso: string,
): BudgetResult => {
  const budget = budgetFor(budgetSet, month)
  const pl = calcPL(reports, month)

  const totalDays = daysInMonth(month)
  const elapsedDays = elapsedDaysOf(month, todayIso)
  const paceRate = totalDays > 0 ? elapsedDays / totalDays : 0

  const rate = (actual: number, plan: number) => (plan > 0 ? actual / plan : null)

  // 売上・人件費は曜日別が入っていればそこから月次目標を積み上げる
  const revenueBudget = monthlyFromWeek(budget.weekdayRevenue, budget.revenue, month)
  const laborBudget = monthlyFromWeek(budget.weekdayLabor, budget.expenses.labor ?? 0, month)

  const expenseLines: BudgetLine[] = ALL_CATEGORIES.map(cat => {
    const actual = pl.expenseByCategory.find(e => e.category === cat)?.amount ?? 0
    const plan = cat === 'labor' ? laborBudget : (budget.expenses[cat] ?? 0)
    return {
      category: cat,
      label: EXPENSE_CATEGORY_LABEL[cat],
      actual,
      budget: plan,
      diff: plan - actual,
      rate: rate(actual, plan),
    }
  })

  const expenseBudget = expenseLines.reduce((s, e) => s + e.budget, 0)
  const profitBudget = revenueBudget - expenseBudget

  return {
    month,
    hasBudget: hasAnyBudget(budget),
    elapsedDays,
    totalDays,
    paceRate,

    revenueActual: pl.revenueTotal,
    revenueBudget,
    revenueRate: rate(pl.revenueTotal, revenueBudget),
    revenueDiff: pl.revenueTotal - revenueBudget,

    expenseLines,
    expenseActual: pl.expenseTotal,
    expenseBudget,
    expenseRate: rate(pl.expenseTotal, expenseBudget),

    profitActual: pl.profit,
    profitBudget,
    profitDiff: pl.profit - profitBudget,

    dailyRevenueTarget: hasWeek(budget.weekdayRevenue)
      ? Math.round(revenueBudget / totalDays)
      : (budget.dailyRevenue > 0
        ? budget.dailyRevenue
        : (budget.revenue > 0 && totalDays > 0 ? Math.round(budget.revenue / totalDays) : 0)),
  }
}

/** 費用がペースを超えているか（消化率が経過率を上回っている＝使いすぎ） */
export const isOverPace = (rate: number | null, paceRate: number) =>
  rate !== null && paceRate > 0 && rate > paceRate

/** 売上がペースに追いついていないか */
export const isBehindPace = (rate: number | null, paceRate: number) =>
  rate !== null && paceRate > 0 && rate < paceRate
