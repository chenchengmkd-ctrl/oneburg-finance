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

// 仕入れ先別／品目別の集計行
export interface PLGroupRow {
  key: string             // 仕入れ先名 または 品目名
  amount: number
  count: number
  category: ExpenseCategory  // 金額が最も大きいカテゴリ（表示のタグ・色に使う）
}

// 品目名が未入力の明細に付けるラベル（何にいくら使ったか分からない金額を可視化するため、
// UNSET_KEY＝仕入れ先未入力とは区別する）
export const NO_LABEL_KEY = '（無題）'

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
        ledger.push({ date, bucket, label: item.label || NO_LABEL_KEY, vendor: item.vendor ?? '', amount: item.amount, category: cat })
      }
    }
  }

  const expenseByCategory: PLExpenseLine[] = (Object.keys(expenseMap) as ExpenseCategory[])
    .map(cat => ({ category: cat, label: EXPENSE_CATEGORY_LABEL[cat], amount: expenseMap[cat] }))

  const revenueTotal = cashSales + corpDeposit + persDeposit
  const expenseTotal = Object.values(expenseMap).reduce((s, v) => s + v, 0)

  return {
    month, cashSales, corpDeposit, persDeposit, revenueTotal,
    expenseByCategory, expenseTotal, expenseTax, profit: revenueTotal - expenseTotal,
    ledger: ledger.sort((a, b) => a.date.localeCompare(b.date)),
    daysWithData: dates.length,
  }
}

export const UNSET_KEY = '（未設定）'

// 引出明細を任意のキー（仕入れ先／品目）で合算する。同じキーは合算し件数も数える。金額の大きい順。
// キーが空の明細は「（未設定）」にまとめる（仕入れ先を付けずに入力した行など）
export const groupLedger = (ledger: PLLedgerRow[], pick: (row: PLLedgerRow) => string): PLGroupRow[] => {
  const map = new Map<string, { amount: number; count: number; byCat: Partial<Record<ExpenseCategory, number>> }>()
  for (const row of ledger) {
    const key = pick(row).trim() || UNSET_KEY
    const cur = map.get(key) ?? { amount: 0, count: 0, byCat: {} }
    cur.amount += row.amount
    cur.count += 1
    cur.byCat[row.category] = (cur.byCat[row.category] ?? 0) + row.amount
    map.set(key, cur)
  }
  return [...map.entries()]
    .map(([key, v]) => {
      // 同じ品目でもカテゴリが混ざりうるので、金額の大きいカテゴリを代表として持たせる
      const top = (Object.entries(v.byCat) as [ExpenseCategory, number][]).sort((a, b) => b[1] - a[1])[0]
      return { key, amount: v.amount, count: v.count, category: top?.[0] ?? 'other' }
    })
    .sort((a, b) => b.amount - a.amount)
}
