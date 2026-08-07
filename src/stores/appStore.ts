import { create } from 'zustand'
import type { Settings, Loan, BalanceReport, ScheduledPayment, Staff, ItemLabelSet, BudgetSet } from '../types'
import { storage, defaultSettings, defaultLoans, defaultPayments, defaultStaff, defaultItemLabelSet, migrateItemLabelSet, defaultBudgetSet, migrateBudgetSet, migrateReport } from '../utils/storage'

interface AppState {
  // 現在のページ
  currentPage: string
  setPage: (page: string) => void

  // 設定
  settings: Settings
  loadSettings: () => Promise<void>
  saveSettings: (s: Partial<Settings>) => Promise<void>

  // 日次残高報告
  reports: Record<string, BalanceReport>
  loadReports: () => Promise<void>
  saveReport: (report: BalanceReport) => Promise<void>

  // 借入・立替金
  loans: Loan[]
  loadLoans: () => Promise<void>
  saveLoan: (loan: Loan) => Promise<void>

  // 支払い予定
  payments: ScheduledPayment[]
  loadPayments: () => Promise<void>
  savePayment: (payment: ScheduledPayment) => Promise<void>
  deletePayment: (id: string) => Promise<void>

  // スタッフ台帳
  staff: Staff[]
  loadStaff: () => Promise<void>
  saveStaff: (staff: Staff) => Promise<void>
  deleteStaff: (id: string) => Promise<void>

  // 品目・仕入れ先マスタ
  itemLabels: ItemLabelSet
  loadItemLabels: () => Promise<void>
  saveItemLabels: (data: ItemLabelSet) => Promise<void>

  // 予算（予実管理）
  budget: BudgetSet
  loadBudget: () => Promise<void>
  saveBudget: (data: BudgetSet) => Promise<void>

  // 選択中の日付
  selectedDate: string
  setSelectedDate: (date: string) => void
}

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const useAppStore = create<AppState>((set, get) => ({
  currentPage: 'dashboard',
  setPage: (page) => set({ currentPage: page }),

  selectedDate: todayStr(),
  setSelectedDate: (date) => set({ selectedDate: date }),

  settings: defaultSettings(),
  loadSettings: async () => {
    const s = (await storage.get<Settings>('settings')) || defaultSettings()
    set({ settings: s })
  },
  saveSettings: async (data) => {
    const s = { ...get().settings, ...data }
    set({ settings: s })
    await storage.set('settings', s)
  },

  reports: {},
  loadReports: async () => {
    const keys = await storage.keys('report:')
    const fetched = await Promise.all(keys.map(key => storage.get<BalanceReport>(key)))
    const reports: Record<string, BalanceReport> = {}
    for (const r of fetched) {
      if (r) reports[r.date] = migrateReport(r)
    }
    set({ reports })
  },
  saveReport: async (report) => {
    set(state => ({ reports: { ...state.reports, [report.date]: report } }))
    await storage.set(`report:${report.date}`, report)
  },

  loans: defaultLoans(),
  loadLoans: async () => {
    const loans = (await storage.get<Loan[]>('loans')) || defaultLoans()
    set({ loans })
  },
  saveLoan: async (loan) => {
    const loans = get().loans.map(l => l.id === loan.id ? loan : l)
    set({ loans })
    await storage.set('loans', loans)
  },

  payments: defaultPayments(),
  loadPayments: async () => {
    const payments = (await storage.get<ScheduledPayment[]>('payments')) || defaultPayments()
    set({ payments })
  },
  savePayment: async (payment) => {
    const existing = get().payments
    const idx = existing.findIndex(p => p.id === payment.id)
    const payments = idx >= 0
      ? existing.map(p => p.id === payment.id ? payment : p)
      : [...existing, payment]
    set({ payments })
    await storage.set('payments', payments)
  },
  deletePayment: async (id) => {
    const payments = get().payments.filter(p => p.id !== id)
    set({ payments })
    await storage.set('payments', payments)
  },

  staff: defaultStaff(),
  loadStaff: async () => {
    const staff = (await storage.get<Staff[]>('staff')) || defaultStaff()
    set({ staff })
  },
  saveStaff: async (member) => {
    const existing = get().staff
    const idx = existing.findIndex(s => s.id === member.id)
    const staff = idx >= 0 ? existing.map(s => s.id === member.id ? member : s) : [...existing, member]
    set({ staff })
    await storage.set('staff', staff)
  },
  deleteStaff: async (id) => {
    const staff = get().staff.filter(s => s.id !== id)
    set({ staff })
    await storage.set('staff', staff)
  },

  itemLabels: defaultItemLabelSet(),
  loadItemLabels: async () => {
    const raw = await storage.get<unknown>('item-labels')
    set({ itemLabels: raw ? migrateItemLabelSet(raw) : defaultItemLabelSet() })
  },
  saveItemLabels: async (data) => {
    set({ itemLabels: data })
    await storage.set('item-labels', data)
  },

  budget: defaultBudgetSet(),
  loadBudget: async () => {
    const raw = await storage.get<unknown>('budget')
    set({ budget: raw ? migrateBudgetSet(raw) : defaultBudgetSet() })
  },
  saveBudget: async (data) => {
    set({ budget: data })
    await storage.set('budget', data)
  },
}))
