import type { BalanceReport, ExpenseCategory } from '../types'
import { EXPENSE_CATEGORY_LABEL } from '../types'
import { itemTax } from './storage'

export interface PLExpenseLine {
  category: ExpenseCategory
  label: string
  amount: number
}

export interface PLLedgerRow {
  date: string
  bucket: 'corp' | 'pers' | 'cash'
  label: string
  vendor: string
  amount: number
  category: ExpenseCategory
}

export interface PLLabelBreakdownItem {
  label: string
  amount: number
  count: number
}

export interface PLLabelBreakdown {
  category: ExpenseCategory
  categoryLabel: string
  total: number
  items: PLLabelBreakdownItem[]  // 金額の大きい順
}

export interface PLResult {
  month: string
  cashSales: number       // 現金売上
  corpDeposit: number     // 法人入金（現金からの銀行入金は除く。純粋な外部入金のみ）
  persDeposit: number     // 個人入金
  revenueTotal: number    // 収入合計
  expenseByCategory: PLExpenseLine[]  // カテゴリ別支出（食品仕入・備品仕入・人件費・家賃・水道光熱費・その他）
  expenseTotal: number    // 支出合計（税込）
  expenseTax: number      // 支出に含まれる消費税（仕入税額）
  profit: number          // 損益 = 収入合計 − 支出合計
  ledger: PLLedgerRow[]   // 全引出明細（日付順）
  labelBreakdown: PLLabelBreakdown[]  // カテゴリ×項目名別の内訳（「肉のハナマサ」ではなく「日本酒」「お米」等、実際に何にコストをかけたか把握する用）
  daysWithData: number
}

const BUCKET_LABEL: Record<'corp' | 'pers' | 'cash', string> = { corp: '法人', pers: '個人', cash: '現金' }
export { BUCKET_LABEL as PL_BUCKET_LABEL }

export interface DailyPLRow {
  date: string
  revenue: number
  expenseByCategory: Record<ExpenseCategory, number>
  expenseTotal: number
  profit: number
}

// 日報：日別の売上・カテゴリ別費用・利益（残高報告の入金・引出明細から自動集計。連動のため入力不要）
export const calcDailyPL = (reports: Record<string, BalanceReport>, month: string): DailyPLRow[] => {
  const dates = Object.keys(reports).filter(d => d.startsWith(month)).sort()

  return dates.map(date => {
    const r = reports[date]
    const revenue = r.cash.sales
      + r.corp.deposits.reduce((s, i) => s + i.amount, 0)
      + r.pers.deposits.reduce((s, i) => s + i.amount, 0)

    const expenseByCategory: Record<ExpenseCategory, number> = {
      ingredient: 0, supplies: 0, labor: 0, rent: 0, utility: 0, other: 0,
    }
    for (const day of [r.corp, r.pers, r.cash]) {
      for (const item of day.withdraws) {
        expenseByCategory[item.category ?? 'other'] += item.amount
      }
    }
    const expenseTotal = Object.values(expenseByCategory).reduce((s, v) => s + v, 0)

    return { date, revenue, expenseByCategory, expenseTotal, profit: revenue - expenseTotal }
  })
}

// 指定月の損益表を計算する。収入は現金売上＋各口座への外部入金、支出はカテゴリ別の引出明細集計
export const calcPL = (reports: Record<string, BalanceReport>, month: string): PLResult => {
  const dates = Object.keys(reports).filter(d => d.startsWith(month)).sort()

  let cashSales = 0
  let corpDeposit = 0
  let persDeposit = 0
  const expenseMap: Record<ExpenseCategory, number> = {
    ingredient: 0, supplies: 0, labor: 0, rent: 0, utility: 0, other: 0,
  }
  const ledger: PLLedgerRow[] = []
  let expenseTax = 0

  for (const date of dates) {
    const r = reports[date]
    cashSales += r.cash.sales
    corpDeposit += r.corp.deposits.reduce((s, i) => s + i.amount, 0)
    persDeposit += r.pers.deposits.reduce((s, i) => s + i.amount, 0)

    for (const [bucket, day] of [['corp', r.corp], ['pers', r.pers], ['cash', r.cash]] as const) {
      for (const item of day.withdraws) {
        const cat = item.category ?? 'other'
        expenseMap[cat] += item.amount
        expenseTax += itemTax(item)
        ledger.push({ date, bucket, label: item.label || '（無題）', vendor: item.vendor ?? '', amount: item.amount, category: cat })
      }
    }
  }

  const expenseByCategory: PLExpenseLine[] = (Object.keys(expenseMap) as ExpenseCategory[])
    .map(cat => ({ category: cat, label: EXPENSE_CATEGORY_LABEL[cat], amount: expenseMap[cat] }))

  const revenueTotal = cashSales + corpDeposit + persDeposit
  const expenseTotal = Object.values(expenseMap).reduce((s, v) => s + v, 0)

  const labelBreakdown = calcLabelBreakdown(ledger)

  return {
    month, cashSales, corpDeposit, persDeposit, revenueTotal,
    expenseByCategory, expenseTotal, expenseTax, profit: revenueTotal - expenseTotal,
    ledger: ledger.sort((a, b) => a.date.localeCompare(b.date)),
    labelBreakdown,
    daysWithData: dates.length,
  }
}

// 引出明細をカテゴリ×項目名で集計する（同じ項目名は合算・件数もカウント。金額の大きい順）
const calcLabelBreakdown = (ledger: PLLedgerRow[]): PLLabelBreakdown[] => {
  const categories = Object.keys(EXPENSE_CATEGORY_LABEL) as ExpenseCategory[]
  return categories.map(category => {
    const byLabel = new Map<string, PLLabelBreakdownItem>()
    for (const row of ledger) {
      if (row.category !== category) continue
      const existing = byLabel.get(row.label)
      if (existing) { existing.amount += row.amount; existing.count += 1 }
      else byLabel.set(row.label, { label: row.label, amount: row.amount, count: 1 })
    }
    const items = [...byLabel.values()].sort((a, b) => b.amount - a.amount)
    return { category, categoryLabel: EXPENSE_CATEGORY_LABEL[category], total: items.reduce((s, i) => s + i.amount, 0), items }
  })
}
