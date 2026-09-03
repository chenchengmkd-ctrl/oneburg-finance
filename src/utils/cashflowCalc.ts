import type { CashflowRecord, CfPlan, CfEntry, CfRowKind, BalanceSnapshot, BalanceReport } from '../types'
import { WD_JP } from './calculations'

// 週次・月次のキャッシュフロー予想。損益ではなく「いつ・いくら現金が動くか」を見るためのものなので、
// 金額はすべて税込（＝実際に動くお金）で扱う。
//
// 行の種類は6つ。現金売上とSquare入金だけは実績から見込みを立て（手修正も可）、
// それ以外は全部そのまま手入力する。固定費／変動費という区別は持たない
// （家賃も鰻仕入も「その日に出ていくお金」という点では同じなので、カテゴリだけで分ける）。

export const ROW_LABEL: Record<CfRowKind, string> = {
  cashSales: '現金売上',
  deposit: 'Square入金',
  personal: '個人収入',
  ingredient: '食品',
  supplies: '備品',
  other: 'その他',
}

export const INCOME_ROWS: CfRowKind[] = ['cashSales', 'deposit', 'personal']
export const EXPENSE_ROWS: CfRowKind[] = ['ingredient', 'supplies', 'other']

/** 手入力する行（見込みを立てる現金売上・Square入金以外） */
export const ENTRY_ROWS: CfRowKind[] = ['personal', 'ingredient', 'supplies', 'other']

export const emptyCfPlan = (): CfPlan => ({ entries: {}, overrides: {}, balances: [] })

/** 保存済みの値と既定値をマージする。項目が増えても古いデータが壊れないようにする */
export const migrateCfPlan = (raw: unknown): CfPlan => {
  const r = (raw ?? {}) as Partial<CfPlan> & { planned?: Record<string, CfEntry[]> }
  const entries: CfPlan['entries'] = { ...(r.entries ?? {}) }
  // 旧形式（planned: 日付→明細）は「その他」の支出として引き継ぐ
  for (const [date, items] of Object.entries(r.planned ?? {})) {
    if (!Array.isArray(items) || items.length === 0) continue
    entries[date] = { ...entries[date], other: [...(entries[date]?.other ?? []), ...items] }
  }
  return {
    entries,
    overrides: r.overrides ?? {},
    balances: [...(r.balances ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
  }
}

/** 指定日以前で最も新しい残高の記録。無ければnull */
export const latestBalanceOn = (plan: CfPlan, dateIso: string): BalanceSnapshot | null => {
  const past = (plan.balances ?? []).filter(b => b.date <= dateIso)
  return past.length > 0 ? past[past.length - 1] : null
}

export const newBalanceSnapshot = (date: string): BalanceSnapshot =>
  ({ date, amount: 0, note: '' })

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

/** 翌週の月曜日。日曜に見れば「明日から」、平日に見れば「次の月曜から」 */
export const nextMonday = (dateIso: string): string => {
  const d = new Date(dateIso)
  const until = (8 - (d.getDay() || 7)) % 7 || 7
  return iso(addDays(d, until))
}

export const weekDates = (startIso: string): string[] => {
  const start = new Date(startIso)
  return Array.from({ length: 7 }, (_, i) => iso(addDays(start, i)))
}

export const monthDates = (month: string): string[] => {
  const [y, m] = month.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  return Array.from({ length: days }, (_, i) => `${y}-${pad2(m)}-${pad2(i + 1)}`)
}

/** startIso〜endIso（両端含む）の連続した日付配列。endIsoがstartIsoより前なら空配列 */
export const dateRange = (startIso: string, endIso: string): string[] => {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const days = Math.round((end.getTime() - start.getTime()) / 86400000)
  if (days < 0) return []
  return Array.from({ length: days + 1 }, (_, i) => iso(addDays(start, i)))
}

export const shiftMonth = (month: string, delta: number): string => {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

interface WeekdayAverage { cash: number; noncash: number }

/**
 * 曜日ごとの現金・現金以外の1日平均。
 * 全期間の単純平均だと土日と平日の差が消えてしまうので曜日別に出す。
 * 実績が無い曜日は全体平均で埋める（0にしてしまうと見込みが立たないため）。
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

/**
 * その金曜に振り込まれる現金以外の売上。精算期間は木曜〜翌水曜（Squareの締めに合わせる）。
 * 期間内で実績がある日はその値を、まだ来ていない日は曜日平均を使う。
 */
const depositFor = (
  fridayIso: string,
  records: Record<string, CashflowRecord>,
  avgs: WeekdayAverage[],
): number => {
  const friday = new Date(fridayIso)
  let total = 0
  for (let i = 8; i >= 2; i--) {
    const d = addDays(friday, -i)
    total += records[iso(d)]?.noncash ?? avgs[d.getDay()].noncash
  }
  return total
}

/** 精算期間（木〜翌水）が全日ぶん実績で埋まっているか＝この金曜の入金額はもう確定か */
const depositWindowFinished = (fridayIso: string, records: Record<string, CashflowRecord>): boolean => {
  const friday = new Date(fridayIso)
  for (let i = 8; i >= 2; i--) {
    if (!records[iso(addDays(friday, -i))]) return false
  }
  return true
}

/** 実績を混ぜず曜日平均だけで見積もった入金額。「当初の予想」として実績と比較するための値 */
const depositForecastOnly = (fridayIso: string, avgs: WeekdayAverage[]): number => {
  const friday = new Date(fridayIso)
  let total = 0
  for (let i = 8; i >= 2; i--) total += avgs[addDays(friday, -i).getDay()].noncash
  return total
}

/** 日次入力（残高報告）から、その日そのカテゴリの実績額を拾う。食品・備品以外の引出は全部「その他」に集約 */
const actualEntryAmount = (kind: 'personal' | 'ingredient' | 'supplies' | 'other', report: BalanceReport): number => {
  if (kind === 'personal') return report.pers.deposits.reduce((s, i) => s + i.amount, 0)
  let total = 0
  for (const bucket of [report.corp, report.pers, report.cash]) {
    for (const item of bucket.withdraws) {
      const cat = item.category ?? 'other'
      if (kind === 'ingredient' && cat === 'ingredient') total += item.amount
      else if (kind === 'supplies' && cat === 'supplies') total += item.amount
      else if (kind === 'other' && cat !== 'ingredient' && cat !== 'supplies') total += item.amount
    }
  }
  return total
}

export interface CfCell {
  amount: number          // 表示用の実効値（実績があれば実績、無ければ予定・見込み）
  forecast: number        // 予定・見込み（手入力の予定 or 曜日平均からの見込み）
  actual: number | null   // 実績（実際にあった額）。まだ無い日はnull
  diff: number | null     // 実績−予定。実績が無い日はnull
  entries: CfEntry[]      // 手入力の明細（見込み行は空。あくまで「予定」側の内訳）
  isOverridden: boolean   // 見込みを手修正しているか（cashSales・depositのみ）
  isActual: boolean       // このマスがいま実績を表示しているか
}

export interface CfRow {
  kind: CfRowKind
  label: string
  isIncome: boolean
  isProjected: boolean   // 見込みを立てる行（現金売上・Square入金）
  cells: Record<string, CfCell>
  total: number
}

export interface CfGrid {
  dates: string[]
  columns: { date: string; label: string; dow: number; isWeekend: boolean }[]
  rows: CfRow[]
  incomeTotal: number
  expenseTotal: number
  net: number
  dailyNet: Record<string, number>
  cumulative: Record<string, number>
  breakevenPerDay: number
  // 残高の見込み。起点の記録があるときだけ入る
  startBalance: BalanceSnapshot | null
  balance: Record<string, number>   // その日の終わりの見込み残高
  lowestDate: string | null         // 見込み残高がいちばん低くなる日
}

/** 縦＝カテゴリ、横＝日付のグリッドを組み立てる。週でも月でも同じ関数で作る */
export const buildCfGrid = (
  dates: string[],
  cashflowRecords: Record<string, CashflowRecord>,
  plan: CfPlan,
  reports: Record<string, BalanceReport>,
  todayIso: string,
): CfGrid => {
  const avgs = weekdayAverages(Object.values(cashflowRecords))

  const columns = dates.map(date => {
    const d = new Date(date)
    return {
      date,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      dow: d.getDay(),
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
    }
  })

  const makeRow = (kind: CfRowKind, isIncome: boolean, isProjected: boolean): CfRow => {
    const cells: Record<string, CfCell> = {}
    let total = 0
    for (const date of dates) {
      const d = new Date(date)
      const override = plan.overrides[date]?.[kind as 'cashSales' | 'deposit']
      const cfRecord = cashflowRecords[date]
      const report = reports[date]
      const elapsed = date <= todayIso
      let amount = 0
      let forecast = 0
      let actual: number | null = null
      let isActual = false
      let entries: CfEntry[] = []

      if (kind === 'cashSales') {
        forecast = override !== undefined ? override : avgs[d.getDay()].cash
        // 実績が取り込まれていれば、仮で入れた見込み（override）より実績を優先する＝日が経てば自動で切り替わる
        if (elapsed && cfRecord) { actual = cfRecord.cash; isActual = true; amount = actual }
        else amount = forecast
      } else if (kind === 'deposit') {
        const isFriday = d.getDay() === 5
        if (!isFriday) {
          amount = override !== undefined ? override : 0
        } else {
          forecast = override !== undefined ? override : depositForecastOnly(date, avgs)
          const finished = elapsed && depositWindowFinished(date, cashflowRecords)
          if (finished) { actual = depositFor(date, cashflowRecords, avgs); isActual = true; amount = actual }
          else amount = override !== undefined ? override : depositFor(date, cashflowRecords, avgs)
        }
      } else {
        entries = plan.entries[date]?.[kind] ?? []
        forecast = entries.reduce((s, e) => s + e.amount, 0)
        if (elapsed && report) { actual = actualEntryAmount(kind, report); isActual = true; amount = actual }
        else amount = forecast
      }

      const diff = actual !== null ? actual - forecast : null
      cells[date] = { amount, forecast, actual, diff, entries, isOverridden: override !== undefined, isActual }
      total += amount
    }
    return { kind, label: ROW_LABEL[kind], isIncome, isProjected, cells, total }
  }

  const rows = [
    ...INCOME_ROWS.map(k => makeRow(k, true, k === 'cashSales' || k === 'deposit')),
    ...EXPENSE_ROWS.map(k => makeRow(k, false, false)),
  ]

  const incomeTotal = rows.filter(r => r.isIncome).reduce((s, r) => s + r.total, 0)
  const expenseTotal = rows.filter(r => !r.isIncome).reduce((s, r) => s + r.total, 0)

  const dailyNet: Record<string, number> = {}
  const cumulative: Record<string, number> = {}
  let running = 0
  for (const date of dates) {
    const inc = rows.filter(r => r.isIncome).reduce((s, r) => s + r.cells[date].amount, 0)
    const exp = rows.filter(r => !r.isIncome).reduce((s, r) => s + r.cells[date].amount, 0)
    dailyNet[date] = inc - exp
    running += inc - exp
    cumulative[date] = running
  }

  // Square入金と個人収入は日々の売上では動かせないので、そこを差し引いた残りを
  // 営業日数で割る＝毎日これだけ現金が入れば支払いが回る、という下限
  const fixedIncome = rows.filter(r => r.kind === 'deposit' || r.kind === 'personal')
    .reduce((s, r) => s + r.total, 0)
  const cashRow = rows.find(r => r.kind === 'cashSales')!
  const openDays = dates.filter(d => cashRow.cells[d].amount > 0).length || dates.length
  const breakeven = Math.max(0, expenseTotal - fixedIncome)

  // 残高の見込み。起点の記録より後の日は、日次収支を順に足していった額を出す。
  // 起点の記録が期間の途中にある場合、それより前の日は遡って引く（記録した日の残高は動かさない）
  const startBalance = latestBalanceOn(plan, dates[dates.length - 1])
  const balance: Record<string, number> = {}
  let lowestDate: string | null = null
  if (startBalance) {
    let running = startBalance.amount
    for (const date of dates) {
      // 残高を確認した日より後だけ予定を反映する（確認済みの実額を予定で上書きしない）
      if (date > startBalance.date) running += dailyNet[date]
      balance[date] = running
      if (lowestDate === null || running < balance[lowestDate]) lowestDate = date
    }
  }

  return {
    dates, columns, rows,
    incomeTotal, expenseTotal, net: incomeTotal - expenseTotal,
    dailyNet, cumulative,
    breakevenPerDay: Math.ceil(breakeven / openDays),
    startBalance, balance, lowestDate,
  }
}

export const newCfEntry = (): CfEntry =>
  ({ id: `cf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name: '', amount: 0 })
