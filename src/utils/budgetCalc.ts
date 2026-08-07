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

// 当月なら今日の日付、過去月ならその月の日数、未来月なら0
const elapsedDaysOf = (month: string, todayIso: string) => {
  const total = daysInMonth(month)
  const nowMonth = todayIso.slice(0, 7)
  if (month < nowMonth) return total
  if (month > nowMonth) return 0
  return Math.min(total, Number(todayIso.slice(8, 10)))
}

export const hasAnyBudget = (b: MonthBudget) =>
  b.revenue > 0 || b.dailyRevenue > 0 || ALL_CATEGORIES.some(c => (b.expenses[c] ?? 0) > 0)

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

  const expenseLines: BudgetLine[] = ALL_CATEGORIES.map(cat => {
    const actual = pl.expenseByCategory.find(e => e.category === cat)?.amount ?? 0
    const plan = budget.expenses[cat] ?? 0
    return {
      category: cat,
      label: EXPENSE_CATEGORY_LABEL[cat],
      actual,
      budget: plan,
      diff: plan - actual,
      rate: rate(actual, plan),
    }
  })

  const expenseBudget = ALL_CATEGORIES.reduce((s, c) => s + (budget.expenses[c] ?? 0), 0)
  const profitBudget = budget.revenue - expenseBudget

  return {
    month,
    hasBudget: hasAnyBudget(budget),
    elapsedDays,
    totalDays,
    paceRate,

    revenueActual: pl.revenueTotal,
    revenueBudget: budget.revenue,
    revenueRate: rate(pl.revenueTotal, budget.revenue),
    revenueDiff: pl.revenueTotal - budget.revenue,

    expenseLines,
    expenseActual: pl.expenseTotal,
    expenseBudget,
    expenseRate: rate(pl.expenseTotal, expenseBudget),

    profitActual: pl.profit,
    profitBudget,
    profitDiff: pl.profit - profitBudget,

    dailyRevenueTarget: budget.dailyRevenue > 0
      ? budget.dailyRevenue
      : (budget.revenue > 0 && totalDays > 0 ? Math.round(budget.revenue / totalDays) : 0),
  }
}

/** 費用がペースを超えているか（消化率が経過率を上回っている＝使いすぎ） */
export const isOverPace = (rate: number | null, paceRate: number) =>
  rate !== null && paceRate > 0 && rate > paceRate

/** 売上がペースに追いついていないか */
export const isBehindPace = (rate: number | null, paceRate: number) =>
  rate !== null && paceRate > 0 && rate < paceRate
