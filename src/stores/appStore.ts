import { create } from 'zustand'
import type { Settings, BalanceReport, Staff, ItemLabelSet, BudgetSet, SalesDetail, CashflowRecord, CfPlan } from '../types'
import { emptyCfPlan, migrateCfPlan } from '../utils/cashflowCalc'
import { storage, defaultSettings, defaultStaff, defaultItemLabelSet, migrateItemLabelSet, defaultBudgetSet, migrateBudgetSet, migrateReport } from '../utils/storage'

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

  // Squareのレジ明細（出数・客数）。ボットが書き込み、アプリは読むだけ
  salesDetails: Record<string, SalesDetail>
  loadSalesDetails: () => Promise<void>

  // Squareの現金／現金以外の内訳。ボットが書き込み、アプリは読むだけ
  cashflowRecords: Record<string, CashflowRecord>
  loadCashflowRecords: () => Promise<void>

  // 週次CF予想の計画（変動支出の予定など）。LINEボットと共有し、アプリからも編集する
  cfPlan: CfPlan
  loadCfPlan: () => Promise<void>
  saveCfPlan: (data: CfPlan) => Promise<void>

  // 選択中の日付
  selectedDate: string
  setSelectedDate: (date: string) => void
}

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const useAppStore = create<AppState>((set, get) => ({
  currentPage: 'home',
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

  salesDetails: {},
  loadSalesDetails: async () => {
    const keys = await storage.keys('sales:')
    const fetched = await Promise.all(keys.map(key => storage.get<SalesDetail>(key)))
    const salesDetails: Record<string, SalesDetail> = {}
    for (const d of fetched) {
      if (d?.date) salesDetails[d.date] = d
    }
    set({ salesDetails })
  },

  cashflowRecords: {},
  loadCashflowRecords: async () => {
    const keys = await storage.keys('cashflow:')
    const fetched = await Promise.all(keys.map(key => storage.get<CashflowRecord>(key)))
    const cashflowRecords: Record<string, CashflowRecord> = {}
    for (const r of fetched) {
      if (r?.date) cashflowRecords[r.date] = r
    }
    set({ cashflowRecords })
  },

  cfPlan: emptyCfPlan(),
  loadCfPlan: async () => {
    const raw = await storage.get<unknown>('cf-plan')
    set({ cfPlan: migrateCfPlan(raw) })
  },
  saveCfPlan: async (data) => {
    set({ cfPlan: data })
    await storage.set('cf-plan', data)
  },
}))
