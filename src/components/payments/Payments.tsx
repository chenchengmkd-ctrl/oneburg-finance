import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { fmt, calcRepaymentDate } from '../../utils/calculations'
import { buildReportSeries } from '../../utils/reportCalc'
import { upcomingPayments, totalByBucket, netCashflow, nextOccurrence } from '../../utils/paymentCalc'
import type { ScheduledPayment, PaymentCategory, PaymentDirection } from '../../types'
import { Plus, Trash2, AlertTriangle, Landmark, ArrowDownCircle, ArrowUpCircle } from 'lucide-react'
import NumberInput from '../common/NumberInput'

const CATEGORY_INFO: Record<PaymentCategory, { label: string; hint: string; bg: string; text: string }> = {
  fixed:    { label: '固定',   hint: '毎月同じ日・同じ金額', bg: 'bg-blue-50',  text: 'text-blue-700' },
  variable: { label: '変動',   hint: '毎月ほぼ同じ日・金額は変動', bg: 'bg-orange-50', text: 'text-orange-700' },
  adhoc:    { label: '突発',   hint: '不定期・都度発生',    bg: 'bg-purple-50', text: 'text-purple-700' },
}
const DIRECTION_INFO: Record<PaymentDirection, { label: string; bg: string; text: string }> = {
  in:  { label: '収入', bg: 'bg-green-50', text: 'text-green-700' },
  out: { label: '支出', bg: 'bg-red-50',   text: 'text-red-700' },
}
const BUCKET_LABEL: Record<string, string> = { corp: '法人', pers: '個人', cash: '現金' }

const emptyDraft = (): Omit<ScheduledPayment, 'id'> => ({
  name: '', category: 'fixed', direction: 'out', amount: 0, bucket: 'corp', dayOfMonth: 1, dueDate: null, linkedLoanId: null, note: '', active: true,
})

function ShortfallCard({ title, income, expense, net, sub }: {
  title: string; income: number; expense: number; net: number; sub?: string
}) {
  const short = net < 0
  return (
    <div className={`card border-l-4 ${short ? 'border-red-500' : 'border-green-500'}`}>
      <div className="card-header">{title}</div>
      <div className="flex items-baseline gap-2">
        <div className={`text-2xl font-bold ${short ? 'text-red-600' : 'text-green-600'}`}>
          {short ? `${fmt(Math.abs(net))} 不足` : `${fmt(net)} 余裕`}
        </div>
        {short && <AlertTriangle size={16} className="text-red-500" />}
      </div>
      <div className="text-xs text-gray-400 mt-1">収入予定 {fmt(income)} − 支出予定 {fmt(expense)}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  )
}

export default function Payments() {
  const { reports, loans, payments, loadReports, loadLoans, loadPayments, saveLoan, savePayment, deletePayment } = useAppStore()
  const [draft, setDraft] = useState(emptyDraft())
  const [repayInputs, setRepayInputs] = useState<Record<string, string>>({})

  useEffect(() => { loadReports(); loadLoans(); loadPayments() }, [])

  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const series = useMemo(() => buildReportSeries(reports), [reports])
  const latest = series[series.length - 1]

  const upcoming7 = useMemo(() => upcomingPayments(payments, todayStr, 7), [payments, todayStr])
  const upcoming30 = useMemo(() => upcomingPayments(payments, todayStr, 30), [payments, todayStr])
  const cf7 = netCashflow(upcoming7)
  const cf30 = netCashflow(upcoming30)
  const bucket7 = totalByBucket(upcoming7.filter(it => it.payment.direction === 'out'))

  const addPayment = () => {
    if (!draft.name) return
    savePayment({ ...draft, id: `p_${Date.now()}` })
    setDraft(emptyDraft())
  }

  const update = (p: ScheduledPayment, patch: Partial<ScheduledPayment>) => savePayment({ ...p, ...patch })

  const repay = (loanId: string) => {
    const loan = loans.find(l => l.id === loanId)
    const amount = Number(repayInputs[loanId] || 0)
    if (!loan || !amount) return
    saveLoan({ ...loan, paidAmount: loan.paidAmount + amount })
    setRepayInputs(prev => ({ ...prev, [loanId]: '' }))
  }

  const grouped: Record<PaymentCategory, ScheduledPayment[]> = {
    fixed: payments.filter(p => p.category === 'fixed'),
    variable: payments.filter(p => p.category === 'variable'),
    adhoc: payments.filter(p => p.category === 'adhoc'),
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">資金繰り予定</h1>
        <p className="text-gray-400 text-sm mt-1">収入・支出の予定をまとめて登録し、いつ・どのくらい資金が足りなくなるかを自動で見える化します</p>
      </div>

      {/* 資金ショート予測 */}
      <p className="section-header">資金ショート予測</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <ShortfallCard title="今後7日間" income={cf7.income} expense={cf7.expense} net={cf7.net}
          sub={latest ? `現在の実質総資産 ${fmt(latest.realBal)} ＋ この差額 = ${fmt(latest.realBal + cf7.net)}` : undefined} />
        <ShortfallCard title="今後30日間" income={cf30.income} expense={cf30.expense} net={cf30.net}
          sub={latest ? `現在の実質総資産 ${fmt(latest.realBal)} ＋ この差額 = ${fmt(latest.realBal + cf30.net)}` : undefined} />
      </div>
      <div className="text-xs text-gray-400 mb-6 -mt-4">
        支出内訳（7日）：法人 {fmt(bucket7.corp)} ／ 個人 {fmt(bucket7.pers)} ／ 現金 {fmt(bucket7.cash)}
      </div>

      <div className="card mb-6">
        <div className="card-header">直近の資金繰り予定一覧</div>
        {upcoming7.length === 0 ? (
          <div className="text-sm text-gray-400 py-3">今後7日間の予定はありません</div>
        ) : (
          <div className="space-y-1.5">
            {upcoming7.map(it => (
              <div key={it.payment.id} className={`flex items-center justify-between text-sm px-2 py-1.5 rounded ${it.overdue ? 'bg-red-50' : 'bg-gray-50'}`}>
                <div className="flex items-center gap-2">
                  {it.overdue && <AlertTriangle size={14} className="text-red-500" />}
                  {it.payment.direction === 'in'
                    ? <ArrowUpCircle size={14} className="text-green-500" />
                    : <ArrowDownCircle size={14} className="text-red-400" />}
                  <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${CATEGORY_INFO[it.payment.category].bg} ${CATEGORY_INFO[it.payment.category].text}`}>
                    {CATEGORY_INFO[it.payment.category].label}
                  </span>
                  <span className="text-gray-700">{it.payment.name}</span>
                  <span className="text-xs text-gray-400">（{BUCKET_LABEL[it.payment.bucket]}）</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs ${it.overdue ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
                    {it.overdue ? '期限超過' : it.date?.slice(5).replace('-', '/')}
                  </span>
                  <span className={`font-bold ${it.payment.direction === 'in' ? 'text-green-600' : 'text-gray-700'}`}>
                    {it.payment.direction === 'in' ? '+' : '-'}{fmt(it.payment.amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 借入・立替金 */}
      <p className="section-header">借入・立替金</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {loans.map(loan => {
          const remaining = Math.max(0, loan.totalAmount - loan.paidAmount)
          const linkedPayment = payments.find(p => p.linkedLoanId === loan.id)
          const monthlyPace = linkedPayment && linkedPayment.amount > 0 ? linkedPayment.amount : 0
          const repayDate = calcRepaymentDate(remaining, monthlyPace)
          return (
            <div key={loan.id} className="card border-l-4 border-purple-500">
              <div className="flex items-center gap-1.5 card-header">
                <Landmark size={12} /> {loan.lender}
              </div>
              <div className="text-xl font-bold text-purple-700">{fmt(remaining)}</div>
              <div className="text-xs text-gray-400 mt-1">
                総額 {fmt(loan.totalAmount)} ／ 返済済 {fmt(loan.paidAmount)}
              </div>
              {monthlyPace > 0 && <div className="text-xs text-gray-400">完済予想：{repayDate}</div>}
              <div className="flex items-center gap-2 mt-3">
                <NumberInput placeholder="返済額"
                  value={Number(repayInputs[loan.id] || 0)}
                  onChange={v => setRepayInputs(prev => ({ ...prev, [loan.id]: v ? String(v) : '' }))}
                  className="w-28 text-right text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-purple-300"/>
                <button onClick={() => repay(loan.id)}
                  className="text-xs bg-purple-700 text-white px-3 py-1.5 rounded font-bold hover:bg-purple-800 transition">
                  返済を記録
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* 資金繰り予定一覧・編集 */}
      <p className="section-header">資金繰り予定一覧（登録・編集）</p>
      {(['fixed', 'variable', 'adhoc'] as PaymentCategory[]).map(cat => (
        <div key={cat} className="card mb-4">
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-xs px-2 py-0.5 rounded font-bold ${CATEGORY_INFO[cat].bg} ${CATEGORY_INFO[cat].text}`}>
              {CATEGORY_INFO[cat].label}
            </span>
            <span className="text-xs text-gray-400">{CATEGORY_INFO[cat].hint}</span>
          </div>
          <div className="space-y-2">
            {grouped[cat].map(p => (
              <div key={p.id} className="flex items-center gap-2 text-sm">
                <button onClick={() => update(p, { direction: p.direction === 'in' ? 'out' : 'in' })}
                  className={`text-xs px-2 py-1 rounded font-bold shrink-0 w-12 ${DIRECTION_INFO[p.direction].bg} ${DIRECTION_INFO[p.direction].text}`}
                  title="クリックで収入/支出を切替">
                  {DIRECTION_INFO[p.direction].label}
                </button>
                <input type="text" value={p.name} onChange={e => update(p, { name: e.target.value })}
                  className="flex-1 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-gray-300" placeholder="名称"/>
                <NumberInput value={p.amount} onChange={v => update(p, { amount: v })}
                  className="w-28 text-right border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-gray-300" placeholder="金額"/>
                <select value={p.bucket} onChange={e => update(p, { bucket: e.target.value as ScheduledPayment['bucket'] })}
                  className="border border-gray-200 rounded px-2 py-1 text-xs">
                  <option value="corp">法人</option>
                  <option value="pers">個人</option>
                  <option value="cash">現金</option>
                </select>
                {cat === 'adhoc' ? (
                  <input type="date" value={p.dueDate || ''} onChange={e => update(p, { dueDate: e.target.value || null })}
                    className="border border-gray-200 rounded px-2 py-1 text-xs w-36"/>
                ) : (
                  <div className="flex items-center gap-1 text-xs text-gray-400 shrink-0">
                    毎月
                    <input type="number" min={1} max={31} value={p.dayOfMonth ?? ''} onChange={e => update(p, { dayOfMonth: Number(e.target.value) || null })}
                      className="w-12 text-right border border-gray-200 rounded px-1 py-1"/>
                    日
                  </div>
                )}
                <span className="text-[10px] text-gray-300 w-16 shrink-0">
                  次回 {nextOccurrence(p, todayStr)?.slice(5).replace('-', '/') ?? '未定'}
                </span>
                <button onClick={() => deletePayment(p.id)} className="text-gray-300 hover:text-red-500 transition shrink-0">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {grouped[cat].length === 0 && <div className="text-xs text-gray-300">登録なし</div>}
          </div>

          {/* 追加フォーム */}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
            <button onClick={() => setDraft(d => ({ ...d, category: cat, direction: d.category === cat && d.direction === 'out' ? 'in' : 'out' }))}
              className={`text-xs px-2 py-1.5 rounded font-bold shrink-0 w-12 ${draft.category === cat ? DIRECTION_INFO[draft.direction].bg : 'bg-gray-100'} ${draft.category === cat ? DIRECTION_INFO[draft.direction].text : 'text-gray-400'}`}>
              {draft.category === cat ? DIRECTION_INFO[draft.direction].label : '支出'}
            </button>
            <input type="text" placeholder="新しい項目を追加（例：バイト入金、現金売上見込み）"
              value={draft.category === cat ? draft.name : ''}
              onFocus={() => setDraft(d => ({ ...d, category: cat }))}
              onChange={e => setDraft(d => ({ ...d, category: cat, name: e.target.value }))}
              className="flex-1 border border-dashed border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"/>
            <button onClick={() => { setDraft(d => ({ ...d, category: cat })); addPayment() }}
              disabled={draft.category !== cat || !draft.name}
              className="flex items-center gap-1 text-xs bg-gray-700 text-white px-3 py-1.5 rounded font-bold hover:bg-gray-800 transition disabled:opacity-30">
              <Plus size={14} /> 追加
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
