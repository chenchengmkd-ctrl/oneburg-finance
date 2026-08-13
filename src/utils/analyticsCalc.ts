import type { BalanceReport, ExpenseCategory } from '../types'
import { calcPL, calcDailyPL, groupLedger } from './plCalc'
import type { PLGroupRow } from './plCalc'
import { WD_JP } from './calculations'

// 分析はすべて税抜（損益表と同じ土俵）。売上0の日は休業日とみなし、平均の分母から外す
// ——「週3日しか開けていない月」と「毎日開けた月」の1日平均が比べられなくなるため。

const catAmount = (lines: { category: ExpenseCategory; amount: number }[], cat: ExpenseCategory) =>
  lines.find(e => e.category === cat)?.amount ?? 0

const ratio = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null)

export interface MonthStat {
  month: string
  openDays: number        // 売上が立った日数（営業日）
  revenue: number         // 税抜
  food: number            // 食材（税抜）
  supplies: number        // 備品
  labor: number           // 人件費
  other: number           // 家賃・光熱費・その他
  expense: number
  profit: number
  foodRate: number | null   // 原価率 = 食材 ÷ 売上
  laborRate: number | null  // 人件費率
  flRate: number | null     // FL比率 =（食材＋人件費）÷ 売上。飲食店の目安は60%以下
  avgRevenue: number        // 営業日1日あたりの売上
  avgProfit: number
}

/** データがある月を古い順に返す */
export const monthsOf = (reports: Record<string, BalanceReport>): string[] =>
  [...new Set(Object.keys(reports).map(d => d.slice(0, 7)))].sort()

export const calcMonthStats = (reports: Record<string, BalanceReport>, months: string[]): MonthStat[] =>
  months.map(month => {
    const pl = calcPL(reports, month)
    const daily = calcDailyPL(reports, month)
    const openDays = daily.filter(d => d.revenueNet > 0).length

    const food = catAmount(pl.expenseByCategory, 'ingredient')
    const supplies = catAmount(pl.expenseByCategory, 'supplies')
    const labor = catAmount(pl.expenseByCategory, 'labor')
    const other = catAmount(pl.expenseByCategory, 'rent')
      + catAmount(pl.expenseByCategory, 'utility')
      + catAmount(pl.expenseByCategory, 'other')

    return {
      month,
      openDays,
      revenue: pl.revenueNet,
      food, supplies, labor, other,
      expense: pl.expenseNet,
      profit: pl.profitNet,
      foodRate: ratio(food, pl.revenueNet),
      laborRate: ratio(labor, pl.revenueNet),
      flRate: ratio(food + labor, pl.revenueNet),
      avgRevenue: openDays > 0 ? Math.round(pl.revenueNet / openDays) : 0,
      avgProfit: openDays > 0 ? Math.round(pl.profitNet / openDays) : 0,
    }
  })

export interface WeekdayStat {
  dow: number
  label: string
  openDays: number
  revenue: number
  labor: number
  afterLabor: number    // 売上 − 人件費
  avgRevenue: number
  avgLabor: number
  avgAfterLabor: number
  laborRate: number | null
}

/**
 * 曜日ごとの成績。どの曜日にいくら売れて、その日の人員にいくらかかったかを比べる。
 *
 * 仕入れ・家賃・光熱費は含めない。鰻代のようなまとめ買いは数日おきに1日だけ大きく計上され、
 * 家賃も月1回なので、たまたま当たった曜日の損益だけが沈む。実際このデータでは
 * 鰻代62,300円が日曜に乗って「日曜は赤字」に見えていた。曜日ごとに毎日発生するのは
 * 売上と人件費なので、この2つだけで比べるほうが判断を誤らない。
 */
export const calcWeekdayStats = (reports: Record<string, BalanceReport>, months: string[]): WeekdayStat[] => {
  const acc = WD_JP.map((label, dow) => ({
    dow, label, openDays: 0, revenue: 0, labor: 0,
  }))

  for (const month of months) {
    for (const row of calcDailyPL(reports, month)) {
      if (row.revenueNet <= 0) continue   // 休業日は平均に混ぜない
      const a = acc[new Date(row.date).getDay()]
      a.openDays += 1
      a.revenue += row.revenueNet
      a.labor += row.expenseByCategory.labor
    }
  }

  return acc.map(a => ({
    ...a,
    afterLabor: a.revenue - a.labor,
    avgRevenue: a.openDays > 0 ? Math.round(a.revenue / a.openDays) : 0,
    avgLabor: a.openDays > 0 ? Math.round(a.labor / a.openDays) : 0,
    avgAfterLabor: a.openDays > 0 ? Math.round((a.revenue - a.labor) / a.openDays) : 0,
    laborRate: ratio(a.labor, a.revenue),
  }))
}

export interface DailyPoint {
  date: string
  label: string      // グラフ用のM/D表記
  revenue: number
  expense: number
  profit: number
}

/** 日別の推移（グラフ用）。休業日も0として残す＝営業の間隔が見えるようにする */
export const calcDailySeries = (reports: Record<string, BalanceReport>, months: string[]): DailyPoint[] =>
  months.flatMap(month =>
    calcDailyPL(reports, month).map(r => ({
      date: r.date,
      label: `${Number(r.date.slice(5, 7))}/${Number(r.date.slice(8, 10))}`,
      revenue: r.revenueNet,
      expense: r.expenseNet,
      profit: r.profitNet,
    })),
  )

export interface CompareRow {
  key: string
  current: number
  previous: number
  diff: number
}

/**
 * 品目（または仕入れ先）を2つの月で比べる。増えた順に返す。
 * 「先月より何にお金を使うようになったか」を見るためのもの。
 */
export const compareGroups = (
  reports: Record<string, BalanceReport>,
  currentMonth: string,
  previousMonth: string,
  pick: 'label' | 'vendor',
): CompareRow[] => {
  const rowsOf = (month: string): PLGroupRow[] => {
    const ledger = calcPL(reports, month).ledger.filter(r => r.category !== 'labor' && r.net !== 0)
    return groupLedger(ledger, r => (pick === 'label' ? r.label : r.vendor))
  }
  const cur = new Map(rowsOf(currentMonth).map(r => [r.key, r.amount]))
  const prev = new Map(rowsOf(previousMonth).map(r => [r.key, r.amount]))

  const keys = new Set([...cur.keys(), ...prev.keys()])
  return [...keys]
    .map(key => {
      const current = cur.get(key) ?? 0
      const previous = prev.get(key) ?? 0
      return { key, current, previous, diff: current - previous }
    })
    .sort((a, b) => b.diff - a.diff)
}

/** FL比率の評価。飲食店の一般的な目安に照らして色分けするために使う */
export const flVerdict = (flRate: number | null): 'good' | 'warn' | 'bad' | null => {
  if (flRate === null) return null
  if (flRate <= 0.6) return 'good'
  if (flRate <= 0.7) return 'warn'
  return 'bad'
}
