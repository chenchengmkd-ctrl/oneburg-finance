import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { fmt, fmtShort, todayStr, WD_JP } from '../../utils/calculations'
import {
  buildCfGrid, nextMonday, mondayOf, weekDates, monthDates, shiftMonth, newCfEntry,
} from '../../utils/cashflowCalc'
import type { CfEntry, CfRowKind } from '../../types'
import NumberInput from '../common/NumberInput'
import { ChevronLeft, ChevronRight, Plus, X, Wallet } from 'lucide-react'

type Mode = 'week' | 'month'

// 選択中のマス（日付×行）。ここだけ明細を開いて編集する
interface Focus { date: string; kind: CfRowKind }

export default function CashflowCalendar() {
  const { cashflowRecords, loadCashflowRecords, cfPlan, loadCfPlan, saveCfPlan, reports, loadReports, setSelectedDate, setPage } = useAppStore()

  const today = todayStr()
  const [mode, setMode] = useState<Mode>('week')
  const [weekStart, setWeekStart] = useState(() => nextMonday(today))
  const [month, setMonth] = useState(() => today.slice(0, 7))
  const [focus, setFocus] = useState<Focus | null>(null)
  const [balanceDate, setBalanceDate] = useState(today)
  const [balanceDraft, setBalanceDraft] = useState(0)

  useEffect(() => { loadCashflowRecords(); loadCfPlan(); loadReports() }, [])

  const dates = useMemo(
    () => (mode === 'week' ? weekDates(weekStart) : monthDates(month)),
    [mode, weekStart, month],
  )
  const grid = useMemo(
    () => buildCfGrid(dates, cashflowRecords, cfPlan, reports, today),
    [dates, cashflowRecords, cfPlan, reports, today],
  )

  // 連続で触っても取りこぼさないよう、保存直前に最新のcfPlanを読み直して差分を当てる
  const patchEntries = (date: string, kind: CfRowKind, apply: (cur: CfEntry[]) => CfEntry[]) => {
    const cur = useAppStore.getState().cfPlan
    const next = apply(cur.entries[date]?.[kind] ?? [])
    const forDate = { ...cur.entries[date] }
    if (next.length > 0) forDate[kind] = next
    else delete forDate[kind]

    const entries = { ...cur.entries }
    if (Object.keys(forDate).length > 0) entries[date] = forDate
    else delete entries[date]
    saveCfPlan({ ...cur, entries })
  }

  const setOverride = (date: string, kind: 'cashSales' | 'deposit', value: number | null) => {
    const cur = useAppStore.getState().cfPlan
    const forDate = { ...cur.overrides[date] }
    if (value === null) delete forDate[kind]
    else forDate[kind] = value

    const overrides = { ...cur.overrides }
    if (Object.keys(forDate).length > 0) overrides[date] = forDate
    else delete overrides[date]
    saveCfPlan({ ...cur, overrides })
  }

  // 残高の記録。同じ日を入れ直したら上書きする（1日に何度も測らないので単純に置き換える）
  const recordBalance = () => {
    const cur = useAppStore.getState().cfPlan
    const balances = [...(cur.balances ?? []).filter(b => b.date !== balanceDate),
      { date: balanceDate, amount: balanceDraft, note: '' }]
      .sort((a, b) => a.date.localeCompare(b.date))
    saveCfPlan({ ...cur, balances })
    setBalanceDraft(0)
  }

  const removeBalance = (date: string) => {
    const cur = useAppStore.getState().cfPlan
    saveCfPlan({ ...cur, balances: (cur.balances ?? []).filter(b => b.date !== date) })
  }

  const shiftWeek = (delta: number) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + delta * 7)
    setWeekStart(mondayOf(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`))
    setFocus(null)
  }

  const positive = grid.net >= 0

  return (
    <>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="section-header mb-0">資金繰りカレンダー</p>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {([['week', '週間'], ['month', '月間']] as const).map(([id, text]) => (
              <button key={id} onClick={() => { setMode(id); setFocus(null) }}
                className={`px-2.5 py-1 rounded text-xs font-bold transition ${mode === id ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                {text}
              </button>
            ))}
          </div>
          {mode === 'week' ? (
            <div className="flex items-center gap-1">
              <button onClick={() => shiftWeek(-1)} className="p-1 rounded hover:bg-gray-200"><ChevronLeft size={16}/></button>
              <button onClick={() => { setWeekStart(nextMonday(today)); setFocus(null) }}
                className="text-xs text-gray-500 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50">来週</button>
              <button onClick={() => shiftWeek(1)} className="p-1 rounded hover:bg-gray-200"><ChevronRight size={16}/></button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={() => { setMonth(m => shiftMonth(m, -1)); setFocus(null) }} className="p-1 rounded hover:bg-gray-200"><ChevronLeft size={16}/></button>
              <span className="text-xs font-bold text-gray-600 w-16 text-center">{month.replace('-', '/')}</span>
              <button onClick={() => { setMonth(m => shiftMonth(m, 1)); setFocus(null) }} className="p-1 rounded hover:bg-gray-200"><ChevronRight size={16}/></button>
            </div>
          )}
        </div>
      </div>
      <p className="text-[11px] text-gray-400 mt-1 mb-2">
        金額は税込。マスを押すとそのまま数字を打ち込めます。現金売上とSquare入金は<strong className="text-gray-500">曜日ごとの実績平均</strong>から見込みを立て（仮の値は「仮」）、
        その日が過ぎて実績（Squareの実績・日次入力の記録）が出ると自動で<strong className="text-green-600">実績「実」</strong>に切り替わります。
        予定とのズレは「予定比」に出ます
      </p>

      {/* サマリー */}
      <div className={`card border-l-4 mb-3 ${positive ? 'border-green-500' : 'border-red-500'}`}>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <div className="card-header">
              {mode === 'week' ? '週次収支' : '月次収支'}（{grid.columns[0].label}〜{grid.columns[grid.columns.length - 1].label}）
            </div>
            <div className={`text-3xl font-black ${positive ? 'text-green-600' : 'text-red-600'}`}>
              {positive ? '+' : ''}{fmt(grid.net)}
            </div>
          </div>
          <div className="text-xs text-gray-500 space-y-0.5">
            <div>収入 {fmt(grid.incomeTotal)}</div>
            <div>支出 {fmt(grid.expenseTotal)}</div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-[11px] text-gray-400">1日あたり必要な現金売上</div>
            <div className="text-lg font-black text-gray-700">{fmt(grid.breakevenPerDay)}</div>
          </div>
        </div>
      </div>

      {/* 縦＝カテゴリ、横＝日付のグリッド。月間は横に長くなるのでスクロールさせる */}
      <div className="card overflow-x-auto mb-3">
        <table className="text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white text-left text-xs text-gray-400 font-normal py-2 pr-3 border-b border-gray-100 min-w-[6rem]">　</th>
              {grid.columns.map(c => (
                <th key={c.date}
                  className={`text-right text-xs font-normal py-2 px-2 border-b border-gray-100 min-w-[4.5rem] ${
                    c.date === today ? 'bg-blue-50 font-bold text-blue-700' : c.isWeekend ? 'text-red-500' : 'text-gray-400'}`}>
                  {c.label}<span className="ml-0.5">({WD_JP[c.dow]})</span>
                </th>
              ))}
              <th className="sticky right-0 z-10 bg-white text-right text-xs text-gray-500 font-bold py-2 pl-3 border-b border-gray-100 min-w-[5.5rem]">合計</th>
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row, i) => (
              <tr key={row.kind} className={!row.isIncome && grid.rows[i - 1]?.isIncome ? 'border-t-2' : ''}>
                <td className={`sticky left-0 z-10 bg-white py-1.5 pr-3 text-xs font-bold whitespace-nowrap ${
                  row.isIncome ? 'text-blue-700' : 'text-orange-700'} ${!row.isIncome && grid.rows[i - 1]?.isIncome ? 'border-t-2 border-gray-200' : ''}`}>
                  {row.label}
                </td>
                {grid.columns.map(c => {
                  const cell = row.cells[c.date]
                  const selected = focus?.date === c.date && focus?.kind === row.kind
                  const isProjectedRow = row.kind === 'cashSales' || row.kind === 'deposit'
                  // 実績が出ている日は数字の出どころが実データなので、マス直接では編集させない
                  const inlineEditable = !cell.isActual
                  const diffFavorable = cell.diff !== null && (row.isIncome ? cell.diff > 0 : cell.diff < 0)

                  const commit = (v: number) => {
                    if (isProjectedRow) setOverride(c.date, row.kind as 'cashSales' | 'deposit', v)
                    // 複数明細が既に入っていても、マスに直接打ち込んだらその1件にまとめる
                    else patchEntries(c.date, row.kind, cur => {
                      if (cur.length === 1) return v === 0 ? [] : [{ ...cur[0], amount: v }]
                      return v === 0 ? [] : [{ ...newCfEntry(), amount: v }]
                    })
                  }

                  const openDaily = () => { setSelectedDate(c.date); setPage('daily') }

                  return (
                    <td key={c.date}
                      className={`p-0 ${!row.isIncome && grid.rows[i - 1]?.isIncome ? 'border-t-2 border-gray-200' : ''}`}>
                      {selected && inlineEditable ? (
                        <NumberInput value={cell.amount} onChange={commit} autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter') e.currentTarget.blur()
                            if (e.key === 'Escape') { e.currentTarget.blur(); setFocus(null) }
                          }}
                          className="w-20 text-right px-2 py-1.5 text-xs font-bold bg-blue-100 ring-1 ring-blue-400 focus:outline-none"/>
                      ) : (
                        <button
                          onClick={() => (inlineEditable
                            ? setFocus(selected ? null : { date: c.date, kind: row.kind })
                            : openDaily())}
                          title={inlineEditable ? undefined : '日次入力で確認・修正'}
                          className={`w-full text-right px-2 py-1.5 text-xs transition ${
                            selected ? 'bg-blue-100 ring-1 ring-blue-400' : 'hover:bg-gray-50'} ${
                            cell.amount === 0 ? 'text-gray-300' : row.isIncome ? 'text-blue-700 font-bold' : 'text-orange-700 font-bold'}`}>
                          <span>
                            {cell.amount === 0 ? '·' : fmtShort(cell.amount)}
                            {cell.isActual && <span className="text-[9px] text-green-600 ml-0.5">実</span>}
                            {cell.isOverridden && !cell.isActual && <span className="text-[9px] text-purple-500 ml-0.5">仮</span>}
                            {!cell.isActual && cell.entries.length > 1 && <span className="text-[9px] text-gray-400 ml-0.5">({cell.entries.length})</span>}
                          </span>
                          {cell.diff !== null && cell.diff !== 0 && (
                            <span className={`block text-[9px] font-normal ${diffFavorable ? 'text-green-600' : 'text-red-500'}`}>
                              予定比{cell.diff > 0 ? '+' : ''}{fmtShort(cell.diff)}
                            </span>
                          )}
                        </button>
                      )}
                    </td>
                  )
                })}
                <td className={`sticky right-0 z-10 bg-white text-right py-1.5 pl-3 text-xs font-black whitespace-nowrap ${
                  row.isIncome ? 'text-blue-700' : 'text-orange-700'} ${!row.isIncome && grid.rows[i - 1]?.isIncome ? 'border-t-2 border-gray-200' : ''}`}>
                  {fmtShort(row.total)}
                </td>
              </tr>
            ))}

            <tr className="border-t-2">
              <td className="sticky left-0 z-10 bg-white py-2 pr-3 text-xs font-bold text-gray-700 border-t-2 border-gray-300">日次収支</td>
              {grid.columns.map(c => (
                <td key={c.date} className={`text-right px-2 py-2 text-xs font-black border-t-2 border-gray-300 ${
                  grid.dailyNet[c.date] >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {grid.dailyNet[c.date] >= 0 ? '+' : ''}{fmtShort(grid.dailyNet[c.date])}
                </td>
              ))}
              <td className={`sticky right-0 z-10 bg-white text-right py-2 pl-3 text-xs font-black border-t-2 border-gray-300 ${
                positive ? 'text-green-600' : 'text-red-600'}`}>
                {positive ? '+' : ''}{fmtShort(grid.net)}
              </td>
            </tr>
            <tr>
              <td className="sticky left-0 z-10 bg-white py-1.5 pr-3 text-xs text-gray-400">累計</td>
              {grid.columns.map(c => (
                <td key={c.date} className={`text-right px-2 py-1.5 text-xs ${
                  grid.cumulative[c.date] >= 0 ? 'text-gray-500' : 'text-red-500 font-bold'}`}>
                  {fmtShort(grid.cumulative[c.date])}
                </td>
              ))}
              <td className="sticky right-0 z-10 bg-white"/>
            </tr>

            {/* 残高の見込み。起点となる記録があるときだけ出す */}
            {grid.startBalance && (
              <tr>
                <td className="sticky left-0 z-10 bg-white py-1.5 pr-3 text-xs font-bold text-teal-700 whitespace-nowrap">残高見込み</td>
                {grid.columns.map(c => {
                  const value = grid.balance[c.date]
                  const isStart = c.date === grid.startBalance!.date
                  return (
                    <td key={c.date} className={`text-right px-2 py-1.5 text-xs font-bold ${
                      value < 0 ? 'text-red-600' : isStart ? 'text-teal-800' : 'text-teal-600'} ${
                      c.date === grid.lowestDate && value < 0 ? 'bg-red-50' : ''}`}>
                      {fmtShort(value)}{isStart && <span className="text-[9px] text-gray-400 ml-0.5">実</span>}
                    </td>
                  )
                })}
                <td className="sticky right-0 z-10 bg-white"/>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 残高の記録と、期間末の見込み */}
      <div className="card mb-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Wallet size={14} className="text-teal-700"/>
          <span className="text-sm font-bold text-teal-700">残高</span>
        </div>

        {grid.startBalance ? (
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 mb-3">
            <div>
              <div className="text-[11px] text-gray-400">
                {grid.startBalance.date.slice(5).replace('-', '/')}時点（記録した実額）
              </div>
              <div className="text-2xl font-black text-teal-800">{fmt(grid.startBalance.amount)}</div>
            </div>
            <div>
              <div className="text-[11px] text-gray-400">
                {grid.columns[grid.columns.length - 1].label}時点の見込み
              </div>
              <div className={`text-2xl font-black ${
                grid.balance[grid.dates[grid.dates.length - 1]] < 0 ? 'text-red-600' : 'text-teal-600'}`}>
                {fmt(grid.balance[grid.dates[grid.dates.length - 1]])}
              </div>
            </div>
            {grid.lowestDate && grid.balance[grid.lowestDate] < 0 && (
              <div className="text-xs text-red-600 font-bold">
                ⚠️ {grid.lowestDate.slice(5).replace('-', '/')}に{fmt(grid.balance[grid.lowestDate])}まで下がる見込みです
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-500 mb-3">
            残高を1度記録すると、そこから予定を足し引きした<strong className="text-gray-700">日ごとの見込み残高</strong>が上の表に出ます。
            日次入力からは実際の銀行残高が分からないため、通帳やアプリで見た額を入れてください
          </p>
        )}

        <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-gray-100">
          <div>
            <div className="text-[10px] text-gray-400 mb-0.5">確認した日</div>
            <input type="date" value={balanceDate} onChange={e => e.target.value && setBalanceDate(e.target.value)}
              className="text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300"/>
          </div>
          <div>
            <div className="text-[10px] text-gray-400 mb-0.5">その時の残高</div>
            <NumberInput value={balanceDraft} onChange={setBalanceDraft}
              className="w-32 text-right text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300"/>
          </div>
          <button onClick={recordBalance} disabled={balanceDraft <= 0}
            className="flex items-center gap-1 text-xs bg-teal-700 text-white px-3 py-2 rounded font-bold hover:bg-teal-800 transition disabled:opacity-30">
            <Plus size={12}/> 記録
          </button>
        </div>

        {(cfPlan.balances ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {[...(cfPlan.balances ?? [])].reverse().slice(0, 8).map(b => (
              <span key={b.date} className="inline-flex items-center gap-1 text-[11px] bg-gray-100 text-gray-700 rounded px-2 py-1">
                {b.date.slice(5).replace('-', '/')} {fmtShort(b.amount)}
                <button onClick={() => removeBalance(b.date)} className="text-gray-400 hover:text-red-500"><X size={10}/></button>
              </span>
            ))}
          </div>
        )}
      </div>

    </>
  )
}
