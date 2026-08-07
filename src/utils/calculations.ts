export const fmt = (n: number) =>
  new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(n)

export const fmtShort = (n: number) =>
  new Intl.NumberFormat('ja-JP').format(Math.round(n))

export const pct = (actual: number, budget: number) =>
  budget === 0 ? '-' : `${Math.round((actual / budget) * 100)}%`

// 完済予想日（残債務と月間の返済ペースから試算）
export const calcRepaymentDate = (
  remainingDebt: number,
  monthlyRepayable: number
): string => {
  if (remainingDebt <= 0) return '完済済み'
  if (monthlyRepayable <= 0) return '試算不可'
  const months = Math.ceil(remainingDebt / monthlyRepayable)
  const now = new Date()
  const target = new Date(now.getFullYear(), now.getMonth() + months, 1)
  return `${target.getFullYear()}年${target.getMonth() + 1}月頃`
}

export const WD_JP = ['日', '月', '火', '水', '木', '金', '土']

// 今日の日付（YYYY-MM-DD、ローカル時刻基準）
export const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const getDayOfWeek = (dateStr: string) => {
  const d = new Date(dateStr)
  return WD_JP[d.getDay()]
}

export const isWeekend = (dateStr: string) => {
  const day = new Date(dateStr).getDay()
  return day === 0 || day === 6
}

// 労働時間の小数（1分単位）を「◯時間◯分」表記にする
export const fmtHours = (h: number) => {
  const totalMin = Math.round(h * 60)
  const hh = Math.floor(totalMin / 60)
  const mm = totalMin % 60
  return mm === 0 ? `${hh}時間` : `${hh}時間${mm}分`
}
