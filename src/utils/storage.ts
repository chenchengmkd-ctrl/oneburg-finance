import type { Settings, Loan, ScheduledPayment, BalanceReport, ReportPending, BucketDay, LineItem, ExpenseCategory, ShiftEntry, Staff } from '../types'
import { supabase } from './supabaseClient'

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

// Supabase（birdmen_kvテーブル）をkey/valueストアとして使う。キー形式は旧localStorage版と同じ「birdmen:xxx」を踏襲
export const storage = {
  async get<T>(key: string): Promise<T | null> {
    const { data, error } = await supabase.from(TABLE).select('value').eq('key', PREFIX + key).maybeSingle()
    if (error) { console.error('storage.get error', error); return null }
    return (data?.value as T) ?? null
  },
  async set<T>(key: string, value: T): Promise<void> {
    const { error } = await supabase.from(TABLE).upsert({ key: PREFIX + key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) console.error('storage.set error', error)
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

export const newLineItem = (category?: ExpenseCategory, vendor?: string): LineItem => ({ id: newItemId(), label: '', amount: 0, category, vendor })

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

// 指定カテゴリの品目名入力候補（デフォルト候補＋過去に実際に使った品目名。入力時の選択候補用）
export const usedLabels = (reports: Record<string, BalanceReport>, category: ExpenseCategory): string[] => {
  const seen = new Set(DEFAULT_ITEM_LABELS[category])
  const extra: string[] = []
  for (const r of Object.values(reports)) {
    for (const bucket of [r.pers, r.corp, r.cash]) {
      for (const w of bucket.withdraws) {
        const label = w.label.trim()
        if (w.category === category && label && !seen.has(label)) { seen.add(label); extra.push(label) }
      }
    }
  }
  return [...DEFAULT_ITEM_LABELS[category], ...extra]
}

// 指定カテゴリの仕入れ先入力候補（デフォルト候補＋過去に実際に使った仕入れ先名）
export const usedVendors = (reports: Record<string, BalanceReport>, category: ExpenseCategory): string[] => {
  const seen = new Set(DEFAULT_VENDOR_LABELS[category])
  const extra: string[] = []
  for (const r of Object.values(reports)) {
    for (const bucket of [r.pers, r.corp, r.cash]) {
      for (const w of bucket.withdraws) {
        const vendor = (w.vendor ?? '').trim()
        if (w.category === category && vendor && !seen.has(vendor)) { seen.add(vendor); extra.push(vendor) }
      }
    }
  }
  return [...DEFAULT_VENDOR_LABELS[category], ...extra]
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
