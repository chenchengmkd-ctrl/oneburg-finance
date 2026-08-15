import type { BalanceReport, ExpenseCategory, SalesDetail, CashflowRecord } from '../types'
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

const daysInMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** その日を含む週の月曜日（YYYY-MM-DD）。月をまたぐ週もそのまま扱う */
const mondayOf = (dateIso: string): string => {
  const d = new Date(dateIso)
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay()
  d.setDate(d.getDate() + diff)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

const shortDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`

/**
 * その日を含む「精算週」の木曜日（YYYY-MM-DD）。SquareがLINEボット側で使っている
 * 精算サイクル（木曜0:00〜翌水曜23:59に発生した現金以外の売上が、次の金曜にまとめて振り込まれる）
 * に揃えるため、月曜始まりの週（mondayOf）とは別に木曜始まりで区切る。
 */
const thursdayOf = (dateIso: string): string => {
  const d = new Date(dateIso)
  const diff = (d.getDay() - 4 + 7) % 7   // 0=日…4=木
  d.setDate(d.getDate() - diff)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export interface CashflowWeekStat {
  weekStart: string
  label: string
  days: number
  cash: number
  noncash: number
  avgCash: number
  avgNoncash: number
}

/** 精算週（木〜水）ごとの現金／現金以外の内訳。過去分すべてを対象にする（LINE通知は先週だけの簡易版） */
export const calcCashflowWeeks = (records: CashflowRecord[]): CashflowWeekStat[] => {
  const acc = new Map<string, { days: number; cash: number; noncash: number }>()
  for (const r of records) {
    const wk = thursdayOf(r.date)
    const a = acc.get(wk) ?? { days: 0, cash: 0, noncash: 0 }
    a.days += 1
    a.cash += r.cash
    a.noncash += r.noncash
    acc.set(wk, a)
  }
  return [...acc.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, a]) => {
      const end = new Date(weekStart)
      end.setDate(end.getDate() + 6)
      const endIso = `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`
      return {
        weekStart,
        label: `${shortDate(weekStart)}〜${shortDate(endIso)}`,
        days: a.days,
        cash: a.cash,
        noncash: a.noncash,
        avgCash: a.days > 0 ? Math.round(a.cash / a.days) : 0,
        avgNoncash: a.days > 0 ? Math.round(a.noncash / a.days) : 0,
      }
    })
}

export interface WeekStat {
  weekStart: string
  label: string           // 「8/4〜8/10」
  openDays: number
  revenue: number
  avgRevenue: number
  customers: number | null      // Squareの明細が無い週はnull（列自体を薄く出す）
  avgCustomers: number | null
  perCustomer: number | null
}

/**
 * 週次まとめ（月曜始まり）。月ごとの推移より短いスパンで直近の勢いを見るためのもの。
 * Squareの出数データは未取込の週もあるため、客数系はnullable＝取れているところだけ表示する。
 */
export const calcWeeklyStats = (
  reports: Record<string, BalanceReport>,
  months: string[],
  salesDetails: Record<string, SalesDetail>,
): WeekStat[] => {
  const acc = new Map<string, { openDays: number; revenue: number; customers: number; custDays: number; custTotal: number }>()

  for (const month of months) {
    for (const row of calcDailyPL(reports, month)) {
      if (row.revenueNet <= 0) continue
      const wk = mondayOf(row.date)
      const a = acc.get(wk) ?? { openDays: 0, revenue: 0, customers: 0, custDays: 0, custTotal: 0 }
      a.openDays += 1
      a.revenue += row.revenueNet
      const sd = salesDetails[row.date]
      if (sd?.customers) {
        a.customers += sd.customers
        a.custDays += 1
        a.custTotal += sd.total
      }
      acc.set(wk, a)
    }
  }

  return [...acc.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, a]) => {
      const end = new Date(weekStart)
      end.setDate(end.getDate() + 6)
      const endIso = `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`
      return {
        weekStart,
        label: `${shortDate(weekStart)}〜${shortDate(endIso)}`,
        openDays: a.openDays,
        revenue: a.revenue,
        avgRevenue: a.openDays > 0 ? Math.round(a.revenue / a.openDays) : 0,
        customers: a.custDays > 0 ? a.customers : null,
        avgCustomers: a.custDays > 0 ? Math.round(a.customers / a.custDays) : null,
        perCustomer: a.customers > 0 ? Math.round(a.custTotal / a.customers) : null,
      }
    })
}

export interface MonthForecast {
  month: string
  daysElapsed: number
  totalDays: number
  openDaysSoFar: number
  projectedOpenDays: number
  actualRevenue: number
  projectedRevenue: number
  actualCustomers: number | null
  projectedCustomers: number | null
}

/**
 * 今月の着地予想。「ここまでの営業日ペース × 1日あたり平均」を残り日数分だけ延ばして見積もる。
 * 進行中の月（今日を含む月）以外はnullを返す（終わった月に着地予想は不要なため）。
 */
export const calcMonthForecast = (
  reports: Record<string, BalanceReport>,
  salesDetails: Record<string, SalesDetail>,
  todayIso: string,
): MonthForecast | null => {
  const month = todayIso.slice(0, 7)
  const totalDays = daysInMonth(month)
  const daysElapsed = Number(todayIso.slice(8, 10))
  const daily = calcDailyPL(reports, month).filter(d => d.revenueNet > 0)
  const openDaysSoFar = daily.length
  if (openDaysSoFar === 0) return null

  const actualRevenue = daily.reduce((s, d) => s + d.revenueNet, 0)
  const openRate = openDaysSoFar / daysElapsed
  const remainingDays = totalDays - daysElapsed
  const projectedOpenDaysRemaining = Math.round(openRate * remainingDays)
  const projectedOpenDays = openDaysSoFar + projectedOpenDaysRemaining
  const avgRevenue = actualRevenue / openDaysSoFar
  const projectedRevenue = Math.round(actualRevenue + avgRevenue * projectedOpenDaysRemaining)

  const custDays = daily.map(d => salesDetails[d.date]).filter((s): s is SalesDetail => !!s?.customers)
  const actualCustomers = custDays.length > 0 ? custDays.reduce((s, d) => s + d.customers, 0) : null
  const projectedCustomers = actualCustomers !== null && custDays.length > 0
    ? Math.round(actualCustomers + (actualCustomers / custDays.length) * projectedOpenDaysRemaining)
    : null

  return {
    month, daysElapsed, totalDays, openDaysSoFar, projectedOpenDays,
    actualRevenue, projectedRevenue, actualCustomers, projectedCustomers,
  }
}

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

// ===== ここからSquareのレジ明細（出数・客数）の集計 =====
// 売上金額は日次データ（report:）が正。こちらは「何が何個売れたか」「何組来たか」という
// レジにしか無い情報を扱う。取り込まれていない日は単に集計から抜けるだけで、他の分析には影響しない。

export interface ItemRank {
  name: string
  qty: number
  amount: number
  share: number     // 売上構成比
}

/** 期間内の出数ランキング（同じ商品名は合算。売上の大きい順） */
export const rankItems = (details: SalesDetail[]): ItemRank[] => {
  const map = new Map<string, { name: string; qty: number; amount: number }>()
  for (const d of details) {
    for (const i of d.items ?? []) {
      const cur = map.get(i.name) ?? { name: i.name, qty: 0, amount: 0 }
      cur.qty += i.qty
      cur.amount += i.amount
      map.set(i.name, cur)
    }
  }
  const rows = [...map.values()].sort((a, b) => b.amount - a.amount)
  const total = rows.reduce((s, r) => s + r.amount, 0)
  return rows.map(r => ({ ...r, share: total > 0 ? r.amount / total : 0 }))
}

export interface CustomerWeekday {
  dow: number
  label: string
  days: number
  customers: number
  avgCustomers: number
  avgPerCustomer: number   // 客単価
}

/** 曜日ごとの客数・客単価 */
export const calcCustomerWeekday = (details: SalesDetail[]): CustomerWeekday[] => {
  const acc = WD_JP.map((label, dow) => ({ dow, label, days: 0, customers: 0, total: 0 }))
  for (const d of details) {
    if (!d.customers) continue
    const a = acc[new Date(d.date).getDay()]
    a.days += 1
    a.customers += d.customers
    a.total += d.total
  }
  return acc.map(a => ({
    dow: a.dow,
    label: a.label,
    days: a.days,
    customers: a.customers,
    avgCustomers: a.days > 0 ? Math.round(a.customers / a.days) : 0,
    avgPerCustomer: a.customers > 0 ? Math.round(a.total / a.customers) : 0,
  }))
}

/** 時間帯ごとの会計数（何時に混むか）。営業していない時間帯は前後を切り落とす */
export const calcHourly = (details: SalesDetail[]): { hour: number; label: string; customers: number }[] => {
  const hours: number[] = new Array(24).fill(0)
  for (const d of details) {
    for (const [h, n] of Object.entries(d.byHour ?? {})) {
      const hour = Number(h)
      if (Number.isInteger(hour) && hour >= 0 && hour < 24) hours[hour] += n
    }
  }
  const first = hours.findIndex(n => n > 0)
  if (first < 0) return []
  let last = 23
  while (last > first && hours[last] === 0) last--
  return hours.slice(first, last + 1)
    .map((customers, i) => ({ hour: first + i, label: `${first + i}時`, customers }))
}

export interface CustomerSummary {
  days: number
  customers: number
  total: number
  avgCustomers: number
  perCustomer: number
}

export const summarizeCustomers = (details: SalesDetail[]): CustomerSummary => {
  const days = details.filter(d => d.customers > 0).length
  const customers = details.reduce((s, d) => s + (d.customers || 0), 0)
  const total = details.reduce((s, d) => s + (d.total || 0), 0)
  return {
    days, customers, total,
    avgCustomers: days > 0 ? Math.round(customers / days) : 0,
    perCustomer: customers > 0 ? Math.round(total / customers) : 0,
  }
}

/** FL比率の評価。飲食店の一般的な目安に照らして色分けするために使う */
export const flVerdict = (flRate: number | null): 'good' | 'warn' | 'bad' | null => {
  if (flRate === null) return null
  if (flRate <= 0.6) return 'good'
  if (flRate <= 0.7) return 'warn'
  return 'bad'
}
