import type { Settings, Loan, ScheduledPayment, BalanceReport, ReportPending, BucketDay, LineItem, ExpenseCategory, ShiftEntry, Staff, ItemLabelSet, LabelDef, TaxRate, MonthBudget, BudgetSet, ShiftPattern, ShiftPatternEntry } from '../types'
import { DEFAULT_TAX_RATE, EXPENSE_CATEGORY_LABEL } from '../types'
import { supabase } from './supabaseClient'

const ALL_CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABEL) as ExpenseCategory[]

// --- 消費税 ---
// LineItem.amountは常に税込。税抜表示・入力はここで相互変換する
export const taxRateOf = (item: Pick<LineItem, 'taxRate' | 'category'>): TaxRate =>
  item.taxRate ?? DEFAULT_TAX_RATE[item.category ?? 'other']

// 税込 → 税抜（1円未満四捨五入）
export const toNet = (gross: number, rate: TaxRate) => Math.round(gross / (1 + rate / 100))

// 税抜 → 税込（1円未満四捨五入）
export const toGross = (net: number, rate: TaxRate) => Math.round(net * (1 + rate / 100))

// 明細1行の税抜額・消費税額
export const itemNet = (item: LineItem) => toNet(item.amount, taxRateOf(item))
export const itemTax = (item: LineItem) => item.amount - itemNet(item)

export const sumNet = (items: LineItem[]) => items.reduce((s, i) => s + itemNet(i), 0)
export const sumTax = (items: LineItem[]) => items.reduce((s, i) => s + itemTax(i), 0)

const PREFIX = 'birdmen:'
const TABLE = 'birdmen_kv'

let itemSeq = 0
const newItemId = () => `li_${Date.now()}_${itemSeq++}`

const emptyBucket = (): BucketDay => ({ prevOverride: null, deposits: [], withdraws: [], balanceOverride: null })

// 旧形式（deposit: number + depositNote: string）から新形式（明細配列）へ変換。既に新形式ならそのまま返す
const migrateBucket = (raw: any): BucketDay => {
  if (!raw) return emptyBucket()
  if (Array.isArray(raw.deposits) && Array.isArray(raw.withdraws)) return raw
  const deposits: LineItem[] = raw.deposit ? [{ id: newItemId(), label: raw.depositNote || '', amount: raw.deposit }] : []
  const withdraws: LineItem[] = raw.withdraw ? [{ id: newItemId(), label: raw.withdrawNote || '', amount: raw.withdraw, category: 'other' }] : []
  return { prevOverride: raw.prevOverride ?? null, deposits, withdraws, balanceOverride: raw.balanceOverride ?? null }
}

// 旧形式（hours: number）から新形式（clockIn/clockOut）へ変換。既に新形式ならそのまま返す
const migrateShift = (raw: any): ShiftEntry => ({
  id: raw.id ?? newItemId(),
  staffName: raw.staffName ?? '',
  clockIn: raw.clockIn ?? '',
  clockOut: raw.clockOut ?? '',
  hourlyWage: raw.hourlyWage ?? 0,
  transport: raw.transport ?? 0,
})

export const migrateReport = (raw: any): BalanceReport => ({
  ...raw,
  pers: migrateBucket(raw.pers),
  corp: migrateBucket(raw.corp),
  cash: { ...migrateBucket(raw.cash), sales: raw.cash?.sales ?? 0, salesNote: raw.cash?.salesNote ?? '', toBank: raw.cash?.toBank ?? 0 },
  shifts: Array.isArray(raw.shifts) ? raw.shifts.map(migrateShift) : [],
})

// 同じキーへの書き込みを直列化する。入力欄を続けて編集すると upsert が同時に飛び、
// サーバーへの到着順が前後して古い値が新しい値を上書きすることがあるため
const writeQueue = new Map<string, Promise<unknown>>()

const enqueueWrite = (key: string, run: () => Promise<void>): Promise<void> => {
  const prev = writeQueue.get(key) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(run)
  writeQueue.set(key, next)
  // 直列の鎖が伸び続けないよう、自分が最後なら片付ける
  next.catch(() => {}).finally(() => { if (writeQueue.get(key) === next) writeQueue.delete(key) })
  return next
}

// Supabase（birdmen_kvテーブル）をkey/valueストアとして使う。キー形式は旧localStorage版と同じ「birdmen:xxx」を踏襲
export const storage = {
  async get<T>(key: string): Promise<T | null> {
    const { data, error } = await supabase.from(TABLE).select('value').eq('key', PREFIX + key).maybeSingle()
    if (error) { console.error('storage.get error', error); return null }
    return (data?.value as T) ?? null
  },
  async set<T>(key: string, value: T): Promise<void> {
    return enqueueWrite(key, async () => {
      const { error } = await supabase.from(TABLE).upsert({ key: PREFIX + key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      if (error) console.error('storage.set error', error)
    })
  },
  async remove(key: string): Promise<void> {
    const { error } = await supabase.from(TABLE).delete().eq('key', PREFIX + key)
    if (error) console.error('storage.remove error', error)
  },
  async keys(prefix: string): Promise<string[]> {
    const { data, error } = await supabase.from(TABLE).select('key').like('key', `${PREFIX}${prefix}%`)
    if (error) { console.error('storage.keys error', error); return [] }
    return (data ?? []).map(r => r.key.slice(PREFIX.length))
  },
}

// デフォルト残高報告（pendingは前日から引き継ぐため引数で受ける）
export const defaultReport = (date: string, pending?: ReportPending): BalanceReport => ({
  date,
  pers: emptyBucket(),
  corp: emptyBucket(),
  cash: { ...emptyBucket(), sales: 0, salesNote: '', toBank: 0 },
  pending: pending ?? { persExpected: 0, corpSquare: 0, cashReturn: 0 },
  shifts: [newShiftEntry(), newShiftEntry()], // 1〜2名分の空枠をあらかじめ用意（保存時に空行は除外される）
  note: ''
})

export const newLineItem = (category?: ExpenseCategory, vendor?: string): LineItem =>
  ({ id: newItemId(), label: '', amount: 0, category, vendor, taxRate: category ? DEFAULT_TAX_RATE[category] : undefined })

export const sumItems = (items: LineItem[]) => items.reduce((s, i) => s + i.amount, 0)

export const newShiftEntry = (staff?: Staff): ShiftEntry => ({
  id: newItemId(),
  staffName: staff?.name ?? '',
  clockIn: '',
  clockOut: '',
  hourlyWage: staff?.hourlyWage ?? 1500,
  transport: staff?.transport ?? 0,
})

// 出勤〜退勤の労働時間（時間の小数、1分単位）。未入力や退勤<出勤はエラーなく0を返す
export const calcShiftHours = (clockIn: string, clockOut: string): number => {
  if (!clockIn || !clockOut) return 0
  const [inH, inM] = clockIn.split(':').map(Number)
  const [outH, outM] = clockOut.split(':').map(Number)
  const mins = (outH * 60 + outM) - (inH * 60 + inM)
  return mins > 0 ? mins / 60 : 0
}

// 日給（1円未満は四捨五入）
export const shiftPay = (s: ShiftEntry) => Math.round(calcShiftHours(s.clockIn, s.clockOut) * s.hourlyWage + s.transport)

// 名前も時刻も未入力の空行かどうか（保存前に除外する用）
export const isBlankShift = (s: ShiftEntry) => !s.staffName && !s.clockIn && !s.clockOut

export const sumShiftPay = (shifts: ShiftEntry[]) => shifts.reduce((sum, s) => sum + shiftPay(s), 0)

// 日次入力の人件費合計は固定IDの明細としてcorp.withdrawsに保存する（食材・備品は複数明細で別管理）
export const QUICK_IDS = { labor: 'quick-labor' } as const

export const getQuick = (withdraws: LineItem[], id: string) => withdraws.find(w => w.id === id)?.amount ?? 0

export const setQuick = (withdraws: LineItem[], id: string, category: ExpenseCategory, label: string, amount: number): LineItem[] => {
  const rest = withdraws.filter(w => w.id !== id)
  return amount > 0 ? [...rest, { id, label, amount, category }] : rest
}

// カテゴリ別の品目名（中区分）デフォルト候補（履歴が空でも最初から選べるように）
export const DEFAULT_ITEM_LABELS: Record<ExpenseCategory, string[]> = {
  ingredient: ['鰻代', 'タレ代', '山椒代', 'お米', '日本酒', '野菜', '調味料', '吉野家', 'コンビニ'],
  supplies: ['シモジマ', 'スギ薬局', 'コンビニ'],
  labor: [],
  rent: ['家賃'],
  utility: ['光熱費'],
  other: ['ATM手数料', 'UQモバイル', 'GOOGLE', 'AMAZON', 'CLAUDE'],
}

// カテゴリ別の仕入れ先（大区分）デフォルト候補
export const DEFAULT_VENDOR_LABELS: Record<ExpenseCategory, string[]> = {
  ingredient: ['肉のハナマサ'],
  supplies: ['シモジマ', 'Amazon', 'コーナン', 'ダイソー'],
  labor: [],
  rent: [],
  utility: [],
  other: [],
}

// 設定画面で編集する品目・仕入れ先マスタの初期値（履歴・コード内デフォルトを合わせたもの）
const defsFor = (cat: ExpenseCategory): LabelDef[] =>
  DEFAULT_ITEM_LABELS[cat].map(name => ({ name, taxRate: DEFAULT_TAX_RATE[cat] }))

export const defaultItemLabelSet = (): ItemLabelSet => ({
  vendors: { ingredient: [...DEFAULT_VENDOR_LABELS.ingredient], supplies: [...DEFAULT_VENDOR_LABELS.supplies], labor: [], rent: [], utility: [], other: [...DEFAULT_VENDOR_LABELS.other] },
  items: { ingredient: defsFor('ingredient'), supplies: defsFor('supplies'), labor: [], rent: defsFor('rent'), utility: defsFor('utility'), other: defsFor('other') },
})

// 旧形式（items が string[] だった頃）のマスタを LabelDef[] へ変換。税率はカテゴリ既定を充てる
export const migrateItemLabelSet = (raw: any): ItemLabelSet => {
  if (!raw) return defaultItemLabelSet()
  const items = {} as Record<ExpenseCategory, LabelDef[]>
  const vendors = {} as Record<ExpenseCategory, string[]>
  for (const cat of ALL_CATEGORIES) {
    const list: any[] = Array.isArray(raw.items?.[cat]) ? raw.items[cat] : []
    items[cat] = list.map(v => typeof v === 'string'
      ? { name: v, taxRate: DEFAULT_TAX_RATE[cat] }
      : { name: v.name, taxRate: (v.taxRate ?? DEFAULT_TAX_RATE[cat]) as TaxRate })
    vendors[cat] = Array.isArray(raw.vendors?.[cat]) ? raw.vendors[cat] : []
  }
  return { vendors, items }
}

// 指定カテゴリの品目候補（マスタ登録分＋過去に実際に使った品目名。履歴分の税率はカテゴリ既定）
export const usedLabelDefs = (reports: Record<string, BalanceReport>, category: ExpenseCategory, master: LabelDef[]): LabelDef[] => {
  const seen = new Set(master.map(d => d.name))
  const extra: LabelDef[] = []
  for (const r of Object.values(reports)) {
    for (const bucket of [r.pers, r.corp, r.cash]) {
      for (const w of bucket.withdraws) {
        const label = w.label.trim()
        if (w.category === category && label && !seen.has(label)) {
          seen.add(label)
          extra.push({ name: label, taxRate: w.taxRate ?? DEFAULT_TAX_RATE[category] })
        }
      }
    }
  }
  return [...master, ...extra]
}

// 指定カテゴリの品目名一覧（datalist用。名前だけ必要な場所で使う）
export const usedLabels = (reports: Record<string, BalanceReport>, category: ExpenseCategory, master: string[] = DEFAULT_ITEM_LABELS[category]): string[] => {
  const seen = new Set(master)
  const extra: string[] = []
  for (const r of Object.values(reports)) {
    for (const bucket of [r.pers, r.corp, r.cash]) {
      for (const w of bucket.withdraws) {
        const label = w.label.trim()
        if (w.category === category && label && !seen.has(label)) { seen.add(label); extra.push(label) }
      }
    }
  }
  return [...master, ...extra]
}

// 指定カテゴリの仕入れ先入力候補（マスタ登録分＋過去に実際に使った仕入れ先名）
export const usedVendors = (reports: Record<string, BalanceReport>, category: ExpenseCategory, master: string[] = DEFAULT_VENDOR_LABELS[category]): string[] => {
  const seen = new Set(master)
  const extra: string[] = []
  for (const r of Object.values(reports)) {
    for (const bucket of [r.pers, r.corp, r.cash]) {
      for (const w of bucket.withdraws) {
        const vendor = (w.vendor ?? '').trim()
        if (w.category === category && vendor && !seen.has(vendor)) { seen.add(vendor); extra.push(vendor) }
      }
    }
  }
  return [...master, ...extra]
}

// 出勤シフトの合計を人件費(quick-labor)へ自動同期した報告を返す
export const applyShiftsToReport = (report: BalanceReport, shifts: ShiftEntry[]): BalanceReport => ({
  ...report,
  shifts,
  corp: { ...report.corp, withdraws: setQuick(report.corp.withdraws, QUICK_IDS.labor, 'labor', '人件費（シフト合計）', sumShiftPay(shifts)) },
})

// スタッフ台帳の初期セット
export const defaultStaff = (): Staff[] => [
  { id: 'tomaru', name: '都丸里帆', hourlyWage: 1500, transport: 960 },
  { id: 'kudo',   name: '工藤香菜', hourlyWage: 1500, transport: 0 },
  { id: 'uehara', name: '上原敦子', hourlyWage: 1500, transport: 356 },
]

// 予算の初期値。すべて0＝未設定（設定画面で入れるまで予実は表示しない）
export const emptyMonthBudget = (): MonthBudget => ({
  revenue: 0,
  dailyRevenue: 0,
  weekdayRevenue: [0, 0, 0, 0, 0, 0, 0],
  weekdayLabor: [0, 0, 0, 0, 0, 0, 0],
  expenses: { ingredient: 0, supplies: 0, labor: 0, rent: 0, utility: 0, other: 0 },
})

export const defaultBudgetSet = (): BudgetSet => ({ default: emptyMonthBudget(), months: {} })

// 保存形式が古い／壊れていても落ちないように正規化する
export const migrateBudgetSet = (raw: any): BudgetSet => {
  if (!raw) return defaultBudgetSet()
  const week = (v: any): number[] => {
    const out = [0, 0, 0, 0, 0, 0, 0]
    if (Array.isArray(v)) for (let i = 0; i < 7; i++) out[i] = Number(v[i]) || 0
    return out
  }
  const norm = (b: any): MonthBudget => {
    const base = emptyMonthBudget()
    if (!b) return base
    const expenses = { ...base.expenses }
    for (const cat of ALL_CATEGORIES) expenses[cat] = Number(b.expenses?.[cat]) || 0
    return {
      revenue: Number(b.revenue) || 0,
      dailyRevenue: Number(b.dailyRevenue) || 0,
      weekdayRevenue: week(b.weekdayRevenue),
      weekdayLabor: week(b.weekdayLabor),
      expenses,
    }
  }
  const months: Record<string, Partial<MonthBudget>> = {}
  for (const [k, v] of Object.entries(raw.months ?? {})) months[k] = norm(v)
  return { default: norm(raw.default), months }
}

// 指定月に適用される予算（月別の上書きがあればそれ、無ければ既定）
export const budgetFor = (set: BudgetSet, month: string): MonthBudget => {
  const base = set.default ?? emptyMonthBudget()
  const over = set.months?.[month]
  if (!over) return base
  return {
    revenue: over.revenue ?? base.revenue,
    dailyRevenue: over.dailyRevenue ?? base.dailyRevenue,
    weekdayRevenue: over.weekdayRevenue ?? base.weekdayRevenue,
    weekdayLabor: over.weekdayLabor ?? base.weekdayLabor,
    expenses: { ...base.expenses, ...(over.expenses ?? {}) },
  }
}

// シフトの曜日パターン（設定は「シフト作成」画面から）
export const defaultShiftPattern = (): ShiftPattern => ({ 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] })

export const migrateShiftPattern = (raw: any): ShiftPattern => {
  const out = defaultShiftPattern()
  if (!raw) return out
  for (let dow = 0; dow < 7; dow++) {
    const list = Array.isArray(raw[dow]) ? raw[dow] : []
    out[dow] = list
      .filter((e: any) => e && typeof e.staffName === 'string')
      .map((e: any) => ({
        id: e.id ?? newItemId(),
        staffName: e.staffName,
        clockIn: e.clockIn ?? '',
        clockOut: e.clockOut ?? '',
      }))
  }
  return out
}

export const newPatternEntry = (staff?: Staff): ShiftPatternEntry => ({
  id: newItemId(),
  staffName: staff?.name ?? '',
  clockIn: '10:00',
  clockOut: '14:30',
})

// デフォルト設定：対象月は常に今月
const currentMonthStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export const defaultSettings = (): Settings => ({
  targetMonth: currentMonthStr(),
})

// デフォルト借入・立替金
export const defaultLoans = (): Loan[] => [
  { id: 'yamashita', lender: '山下智子', borrowedDate: '2026-06-24',
    totalAmount: 170000, paidAmount: 0, priority: 'high', note: '' },
  { id: 'mukai', lender: '薙刀', borrowedDate: '',
    totalAmount: 30000, paidAmount: 0, priority: 'medium', note: '現金売上からの立替分。総額は変動あり' },
]

// デフォルト資金繰り予定（固定費・変動費・突発の初期セット。すべて支出=out）
export const defaultPayments = (): ScheduledPayment[] => [
  { id: 'rent', name: '家賃', category: 'fixed', direction: 'out', amount: 0, bucket: 'corp', dayOfMonth: 25, dueDate: null, linkedLoanId: null, note: '', active: true },
  { id: 'uq', name: 'UQ mobile', category: 'fixed', direction: 'out', amount: 4381, bucket: 'corp', dayOfMonth: 15, dueDate: null, linkedLoanId: null, note: '', active: true },
  { id: 'googleone', name: 'Google One', category: 'fixed', direction: 'out', amount: 1450, bucket: 'corp', dayOfMonth: 15, dueDate: null, linkedLoanId: null, note: '', active: true },
  { id: 'amazon', name: 'Amazon プライム', category: 'fixed', direction: 'out', amount: 600, bucket: 'corp', dayOfMonth: 15, dueDate: null, linkedLoanId: null, note: '', active: true },
  { id: 'claude', name: 'Claude Pro', category: 'fixed', direction: 'out', amount: 3671, bucket: 'corp', dayOfMonth: 15, dueDate: null, linkedLoanId: null, note: '', active: true },
  { id: 'gmogw', name: 'GMO Payment GW', category: 'fixed', direction: 'out', amount: 2338, bucket: 'corp', dayOfMonth: 15, dueDate: null, linkedLoanId: null, note: '', active: true },
  { id: 'utility', name: '水道光熱費', category: 'variable', direction: 'out', amount: 0, bucket: 'corp', dayOfMonth: 10, dueDate: null, linkedLoanId: null, note: '', active: true },
  { id: 'salary', name: 'スタッフ給与', category: 'variable', direction: 'out', amount: 0, bucket: 'corp', dayOfMonth: 25, dueDate: null, linkedLoanId: null, note: '', active: true },
  { id: 'mukai-return', name: '薙刀への返却', category: 'adhoc', direction: 'out', amount: 30000, bucket: 'cash', dayOfMonth: null, dueDate: null, linkedLoanId: 'mukai', note: '', active: true },
  { id: 'yamashita-repay', name: '山下智子への返済', category: 'adhoc', direction: 'out', amount: 0, bucket: 'corp', dayOfMonth: null, dueDate: null, linkedLoanId: 'yamashita', note: '現在は返済予定なし', active: false },
]
