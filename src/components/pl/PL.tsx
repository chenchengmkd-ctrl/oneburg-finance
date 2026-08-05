import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { fmt, fmtShort } from '../../utils/calculations'
import { calcPL, calcDailyPL, PL_BUCKET_LABEL } from '../../utils/plCalc'
import { downloadCsv } from '../../utils/csvExport'
import { EXPENSE_CATEGORY_LABEL } from '../../types'
import type { ExpenseCategory } from '../../types'
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Download } from 'lucide-react'

const CATEGORY_COLOR: Record<string, string> = {
  ingredient: 'bg-red-500',
  supplies:   'bg-orange-500',
  labor:      'bg-purple-500',
  rent:       'bg-amber-500',
  utility:    'bg-teal-500',
  other:      'bg-gray-400',
}

const EXPENSE_CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABEL) as ExpenseCategory[]

const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function PL() {
  const { reports, loadReports, settings, loadSettings } = useAppStore()
  const [month, setMonth] = useState('')

  useEffect(() => { loadReports(); loadSettings() }, [])
  useEffect(() => { if (!month && settings.targetMonth) setMonth(settings.targetMonth) }, [settings.targetMonth])

  const pl = useMemo(() => month ? calcPL(reports, month) : null, [reports, month])
  const daily = useMemo(() => month ? calcDailyPL(reports, month) : [], [reports, month])
  if (!pl) return null

  const maxExpense = Math.max(1, ...pl.expenseByCategory.map(e => e.amount))
  const profitable = pl.profit >= 0

  const exportDailyCsv = () => {
    const header = ['日付', '売上', ...EXPENSE_CATEGORIES.map(c => EXPENSE_CATEGORY_LABEL[c]), '支出計', '利益']
    const rows = daily.map(row => [
      row.date, row.revenue, ...EXPENSE_CATEGORIES.map(c => row.expenseByCategory[c]), row.expenseTotal, row.profit,
    ])
    const total = ['合計', pl.revenueTotal, ...EXPENSE_CATEGORIES.map(c => pl.expenseByCategory.find(e => e.category === c)?.amount ?? 0), pl.expenseTotal, pl.profit]
    downloadCsv(`損益表_日報_${month}.csv`, [header, ...rows, total])
  }

  const exportLedgerCsv = () => {
    const header = ['日付', '口座', '分類', '仕入れ先', '内容', '金額']
    const rows = pl.ledger.map(row => [row.date, PL_BUCKET_LABEL[row.bucket], pl.expenseByCategory.find(e => e.category === row.category)?.label ?? row.category, row.vendor, row.label, row.amount])
    downloadCsv(`損益表_支出明細_${month}.csv`, [header, ...rows])
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => setMonth(m => shiftMonth(m, -1))} className="p-1.5 rounded hover:bg-gray-200 transition"><ChevronLeft size={20}/></button>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">損益表</h1>
          <p className="text-gray-400 text-sm">{month.replace('-', '年')}月 ／ 残高報告の入金・引出明細から自動集計</p>
        </div>
        <button onClick={() => setMonth(m => shiftMonth(m, 1))} className="p-1.5 rounded hover:bg-gray-200 transition"><ChevronRight size={20}/></button>
      </div>

      {pl.daysWithData === 0 ? (
        <div className="card text-center py-12 text-gray-400 text-sm">この月の残高報告がまだありません</div>
      ) : (
        <>
          {/* 損益サマリー */}
          <div className={`card border-l-4 mb-6 ${profitable ? 'border-green-500' : 'border-red-500'}`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="card-header flex items-center gap-1">
                  {profitable ? <TrendingUp size={12}/> : <TrendingDown size={12}/>} 当月損益
                </div>
                <div className={`text-3xl font-black ${profitable ? 'text-green-600' : 'text-red-600'}`}>
                  {profitable ? '+' : ''}{fmt(pl.profit)}
                </div>
              </div>
              <div className="text-right text-xs text-gray-400">
                <div>収入合計 {fmt(pl.revenueTotal)}</div>
                <div>支出合計 {fmt(pl.expenseTotal)}</div>
                <div className="mt-1">{pl.daysWithData}日分のデータ</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* 売上高 */}
            <div>
              <p className="section-header">売上高</p>
              <div className="card">
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b border-gray-50">
                      <td className="py-2 text-gray-500">現金売上</td>
                      <td className="py-2 text-right font-bold text-blue-700">{fmt(pl.cashSales)}</td>
                    </tr>
                    <tr className="border-b border-gray-50">
                      <td className="py-2 text-gray-500">法人入金（外部）</td>
                      <td className="py-2 text-right font-bold text-blue-700">{fmt(pl.corpDeposit)}</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-gray-500">個人入金</td>
                      <td className="py-2 text-right font-bold text-green-700">{fmt(pl.persDeposit)}</td>
                    </tr>
                    <tr className="border-t-2 border-gray-200">
                      <td className="py-2 font-bold">収入合計</td>
                      <td className="py-2 text-right font-black">{fmt(pl.revenueTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* 費用の部 */}
            <div>
              <p className="section-header">費用の部（仕入・経費・人件費）</p>
              <div className="card">
                <div className="space-y-2">
                  {pl.expenseByCategory.map(e => (
                    <div key={e.category}>
                      <div className="flex justify-between text-sm mb-0.5">
                        <span className="text-gray-600">{e.label}</span>
                        <span className="font-bold text-gray-700">{fmt(e.amount)}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded overflow-hidden">
                        <div className={`h-full ${CATEGORY_COLOR[e.category]} rounded`} style={{ width: `${(e.amount / maxExpense) * 100}%` }}/>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-3 pt-3 border-t-2 border-gray-200">
                  <span className="font-bold">費用合計（税込）</span>
                  <span className="font-black">{fmt(pl.expenseTotal)}</span>
                </div>
                <div className="flex justify-between mt-1 text-xs text-gray-400">
                  <span>うち消費税（仕入税額）</span>
                  <span>{fmt(pl.expenseTax)}</span>
                </div>
                <div className="flex justify-between mt-0.5 text-xs text-gray-500">
                  <span>税抜の費用合計</span>
                  <span className="font-bold">{fmt(pl.expenseTotal - pl.expenseTax)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 品目別内訳：どの店にいくら、ではなく何にコストをかけているかを見る */}
          {pl.labelBreakdown.some(c => c.items.length > 0) && (
            <>
              <p className="section-header mt-6">品目別内訳</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                {pl.labelBreakdown.filter(c => c.items.length > 0).map(cat => {
                  const catMax = Math.max(1, ...cat.items.map(i => i.amount))
                  return (
                    <div key={cat.category} className="card">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-gray-500">{cat.categoryLabel}</span>
                        <span className="text-xs font-black text-gray-700">{fmt(cat.total)}</span>
                      </div>
                      <div className="space-y-1.5">
                        {cat.items.map(item => (
                          <div key={item.label}>
                            <div className="flex items-center gap-2 text-xs mb-0.5">
                              <span className="flex-1 truncate text-gray-600">{item.label}{item.count > 1 ? ` ×${item.count}` : ''}</span>
                              <span className="font-bold text-gray-700 shrink-0">{fmtShort(item.amount)}</span>
                            </div>
                            <div className="h-1 bg-gray-100 rounded overflow-hidden">
                              <div className={`h-full ${CATEGORY_COLOR[cat.category]} rounded`} style={{ width: `${(item.amount / catMax) * 100}%` }}/>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* 日報：日別の売上・利益 */}
          <div className="flex items-center justify-between mt-6">
            <p className="section-header">日報（日別売上・利益）</p>
            <button onClick={exportDailyCsv}
              className="flex items-center gap-1 text-xs text-gray-600 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50">
              <Download size={12}/> CSVダウンロード
            </button>
          </div>
          <div className="card overflow-x-auto mb-6">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="border-b border-gray-100 text-gray-400 text-xs">
                  <th className="text-left py-2 pr-3">日付</th>
                  <th className="text-right pr-3">売上</th>
                  {EXPENSE_CATEGORIES.map(cat => (
                    <th key={cat} className="text-right pr-3">{EXPENSE_CATEGORY_LABEL[cat]}</th>
                  ))}
                  <th className="text-right pr-3">支出計</th>
                  <th className="text-right">利益</th>
                </tr>
              </thead>
              <tbody>
                {[...daily].reverse().map(row => (
                  <tr key={row.date} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-1.5 pr-3 text-gray-500">{row.date.slice(5)}</td>
                    <td className="text-right pr-3 text-blue-700 font-bold">{fmtShort(row.revenue)}</td>
                    {EXPENSE_CATEGORIES.map(cat => (
                      <td key={cat} className="text-right pr-3 text-gray-600">
                        {row.expenseByCategory[cat] > 0 ? fmtShort(row.expenseByCategory[cat]) : '-'}
                      </td>
                    ))}
                    <td className="text-right pr-3 text-red-600 font-bold">{fmtShort(row.expenseTotal)}</td>
                    <td className={`text-right font-black ${row.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {row.profit >= 0 ? '+' : ''}{fmtShort(row.profit)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-200 font-bold">
                  <td className="py-2 pr-3">合計</td>
                  <td className="text-right pr-3 text-blue-700">{fmtShort(pl.revenueTotal)}</td>
                  {EXPENSE_CATEGORIES.map(cat => (
                    <td key={cat} className="text-right pr-3 text-gray-700">
                      {fmtShort(pl.expenseByCategory.find(e => e.category === cat)?.amount ?? 0)}
                    </td>
                  ))}
                  <td className="text-right pr-3 text-red-600">{fmtShort(pl.expenseTotal)}</td>
                  <td className={`text-right ${pl.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {pl.profit >= 0 ? '+' : ''}{fmtShort(pl.profit)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 明細台帳 */}
          <div className="flex items-center justify-between mt-6">
            <p className="section-header">支出明細（{month.replace('-', '年')}月）</p>
            {pl.ledger.length > 0 && (
              <button onClick={exportLedgerCsv}
                className="flex items-center gap-1 text-xs text-gray-600 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50">
                <Download size={12}/> CSVダウンロード
              </button>
            )}
          </div>
          <div className="card overflow-x-auto">
            {pl.ledger.length === 0 ? (
              <div className="text-sm text-gray-400 py-3 text-center">この月の引出明細はまだありません</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-400 text-xs">
                    <th className="text-left py-2 pr-3">日付</th>
                    <th className="text-left pr-3">口座</th>
                    <th className="text-left pr-3">分類</th>
                    <th className="text-left pr-3">仕入れ先</th>
                    <th className="text-left pr-3">内容</th>
                    <th className="text-right">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {pl.ledger.map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-1.5 pr-3 text-gray-500">{row.date.slice(5)}</td>
                      <td className="pr-3 text-gray-500">{PL_BUCKET_LABEL[row.bucket]}</td>
                      <td className="pr-3">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded text-white ${CATEGORY_COLOR[row.category]}`}>
                          {pl.expenseByCategory.find(e => e.category === row.category)?.label}
                        </span>
                      </td>
                      <td className="pr-3 text-gray-400">{row.vendor || '-'}</td>
                      <td className="pr-3 text-gray-700">{row.label}</td>
                      <td className="text-right font-bold text-gray-700">{fmtShort(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
