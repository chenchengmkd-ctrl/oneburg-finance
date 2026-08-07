import { useEffect, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { storage } from '../../utils/storage'
import { supabase } from '../../utils/supabaseClient'
import { EXPENSE_CATEGORY_LABEL, DEFAULT_TAX_RATE } from '../../types'
import type { ExpenseCategory, LabelDef, TaxRate, MonthBudget } from '../../types'
import { emptyMonthBudget, budgetFor } from '../../utils/storage'
import { fmt } from '../../utils/calculations'
import NumberInput from '../common/NumberInput'
import { Plus, Trash2, UploadCloud } from 'lucide-react'

const LOCAL_PREFIX = 'birdmen:'

const ALL_EXPENSE_CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABEL) as ExpenseCategory[]

// 品目・仕入れ先マスタを管理するカテゴリ（人件費・家賃・光熱費は明細を細かく分けないため対象外）
const LABEL_CATEGORIES: ExpenseCategory[] = ['ingredient', 'supplies', 'other']

// 名前だけのリスト（仕入れ先）の追加・削除エディタ
function VendorListEditor({ title, values, onChange }: {
  title: string; values: string[]; onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const name = draft.trim()
    if (!name || values.includes(name)) { setDraft(''); return }
    onChange([...values, name])
    setDraft('')
  }

  return (
    <div>
      <div className="text-xs font-bold text-gray-500 mb-1.5">{title}</div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map(v => (
          <span key={v} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 rounded px-2 py-1">
            {v}
            <button onClick={() => onChange(values.filter(x => x !== v))} className="text-gray-400 hover:text-red-500">
              <Trash2 size={11}/>
            </button>
          </span>
        ))}
        {values.length === 0 && <span className="text-xs text-gray-300">登録なし</span>}
      </div>
      <div className="flex items-center gap-2">
        <input type="text" value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }} placeholder="追加する名前"
          className="flex-1 border border-dashed border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300"/>
        <button onClick={add} disabled={!draft.trim()}
          className="flex items-center gap-1 text-xs bg-gray-700 text-white px-2.5 py-1 rounded font-bold hover:bg-gray-800 transition disabled:opacity-30">
          <Plus size={12}/> 追加
        </button>
      </div>
    </div>
  )
}

// 予算エディタ。金額はすべて税込（実績と同じ土俵で比べるため）
// 変更は「差分（patch）」で親に渡す。全体を組み立てて渡すと、連続更新のときに
// 古いvalueを元にした保存が新しい値を上書きしてしまうため
function BudgetEditor({ value, onPatch, onPatchExpense, month, isDefault }: {
  value: MonthBudget
  onPatch: (patch: Partial<Omit<MonthBudget, 'expenses'>>) => void
  onPatchExpense: (cat: ExpenseCategory, v: number) => void
  month: string; isDefault: boolean
}) {
  const expenseTotal = ALL_EXPENSE_CATEGORIES.reduce((s, c) => s + (value.expenses[c] ?? 0), 0)
  const days = (() => {
    const [y, m] = month.split('-').map(Number)
    return new Date(y, m, 0).getDate()
  })()
  const autoDaily = value.revenue > 0 ? Math.round(value.revenue / days) : 0

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 w-24 shrink-0">売上目標（月）</span>
        <NumberInput value={value.revenue} onChange={v => onPatch({ revenue: v })}
          className="flex-1 text-right text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"/>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 w-24 shrink-0">1日の売上目標</span>
        <NumberInput value={value.dailyRevenue} onChange={v => onPatch({ dailyRevenue: v })}
          className="flex-1 text-right text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"/>
      </div>
      <p className="text-[11px] text-gray-400 -mt-1">
        0のままなら「売上目標 ÷ {days}日 = {fmt(autoDaily)}」を自動で使います
      </p>

      <div className="pt-2 border-t border-gray-100">
        <div className="text-xs font-bold text-gray-500 mb-2">費用予算（カテゴリ別・月）</div>
        <div className="space-y-2">
          {ALL_EXPENSE_CATEGORIES.map(cat => (
            <div key={cat} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-24 shrink-0">{EXPENSE_CATEGORY_LABEL[cat]}</span>
              <NumberInput value={value.expenses[cat] ?? 0} onChange={v => onPatchExpense(cat, v)}
                className="flex-1 text-right text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"/>
            </div>
          ))}
        </div>
      </div>

      <div className="pt-2 border-t border-gray-100 space-y-1 text-xs">
        <div className="flex justify-between"><span className="text-gray-500">費用予算 合計</span><span className="font-bold">{fmt(expenseTotal)}</span></div>
        <div className="flex justify-between">
          <span className="text-gray-500">目標損益</span>
          <span className={`font-black ${value.revenue - expenseTotal >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {fmt(value.revenue - expenseTotal)}
          </span>
        </div>
      </div>

      {isDefault && (
        <p className="text-[11px] text-gray-400">
          ここで入れた値が毎月の既定になります。特定の月だけ変えたい場合は上の切替を「{month.replace('-', '年')}月だけ」にしてください
        </p>
      )}
    </div>
  )
}

// 品目マスタ（名前＋消費税率）の追加・削除・税率変更エディタ
function ItemListEditor({ defaultRate, values, onChange }: {
  defaultRate: TaxRate; values: LabelDef[]; onChange: (next: LabelDef[]) => void
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const name = draft.trim()
    if (!name || values.some(v => v.name === name)) { setDraft(''); return }
    onChange([...values, { name, taxRate: defaultRate }])
    setDraft('')
  }
  const setRate = (name: string, taxRate: TaxRate) =>
    onChange(values.map(v => v.name === name ? { ...v, taxRate } : v))

  return (
    <div>
      <div className="text-xs font-bold text-gray-500 mb-1.5">品目（中区分）／ 消費税率</div>
      <div className="space-y-1 mb-2">
        {values.map(v => (
          <div key={v.name} className="flex items-center gap-2">
            <span className="flex-1 text-xs text-gray-700 truncate">{v.name}</span>
            <select value={v.taxRate} onChange={e => setRate(v.name, Number(e.target.value) as TaxRate)}
              className="w-20 text-[11px] border border-gray-200 rounded px-1 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
              <option value={8}>8%</option>
              <option value={10}>10%</option>
              <option value={0}>非課税</option>
            </select>
            <button onClick={() => onChange(values.filter(x => x.name !== v.name))} className="text-gray-300 hover:text-red-500 shrink-0">
              <Trash2 size={12}/>
            </button>
          </div>
        ))}
        {values.length === 0 && <span className="text-xs text-gray-300">登録なし</span>}
      </div>
      <div className="flex items-center gap-2">
        <input type="text" value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }} placeholder="追加する品目名"
          className="flex-1 border border-dashed border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300"/>
        <button onClick={add} disabled={!draft.trim()}
          className="flex items-center gap-1 text-xs bg-gray-700 text-white px-2.5 py-1 rounded font-bold hover:bg-gray-800 transition disabled:opacity-30">
          <Plus size={12}/> 追加
        </button>
      </div>
    </div>
  )
}

export default function Settings() {
  const { settings, staff, itemLabels, budget, loadSettings, saveSettings, loadStaff, saveStaff, deleteStaff, loadItemLabels, saveItemLabels, loadBudget, saveBudget } = useAppStore()
  const [budgetScope, setBudgetScope] = useState<'default' | 'month'>('default')
  const [newName, setNewName] = useState('')
  const [migrating, setMigrating] = useState(false)
  const [migrateResult, setMigrateResult] = useState<string | null>(null)
  const localKeys = Object.keys(localStorage).filter(k => k.startsWith(LOCAL_PREFIX))

  useEffect(() => { loadSettings(); loadStaff(); loadItemLabels(); loadBudget() }, [])

  const updateLabels = (kind: 'vendors', cat: ExpenseCategory, next: string[]) =>
    saveItemLabels({ ...itemLabels, [kind]: { ...itemLabels[kind], [cat]: next } })

  const targetMonth = settings.targetMonth
  // 「毎月の既定」か「この月だけ」かで、編集対象と保存先を切り替える
  const editingBudget: MonthBudget = budgetScope === 'default'
    ? (budget.default ?? emptyMonthBudget())
    : budgetFor(budget, targetMonth)

  // 保存のたびにストアの最新値を読み直してから差分を当てる（連続更新で取りこぼさないため）
  const patchBudget = (apply: (cur: MonthBudget) => MonthBudget) => {
    const cur = useAppStore.getState().budget
    if (budgetScope === 'default') {
      saveBudget({ ...cur, default: apply(cur.default ?? emptyMonthBudget()) })
    } else {
      saveBudget({ ...cur, months: { ...cur.months, [targetMonth]: apply(budgetFor(cur, targetMonth)) } })
    }
  }

  const onPatchBudget = (patch: Partial<Omit<MonthBudget, 'expenses'>>) =>
    patchBudget(cur => ({ ...cur, ...patch }))

  const onPatchBudgetExpense = (cat: ExpenseCategory, v: number) =>
    patchBudget(cur => ({ ...cur, expenses: { ...cur.expenses, [cat]: v } }))

  const clearMonthOverride = () => {
    const months = { ...budget.months }
    delete months[targetMonth]
    saveBudget({ ...budget, months })
    setBudgetScope('default')
  }

  const migrateFromLocalStorage = async () => {
    setMigrating(true)
    setMigrateResult(null)
    let count = 0
    for (const key of localKeys) {
      try {
        const value = JSON.parse(localStorage.getItem(key)!)
        await storage.set(key.slice(LOCAL_PREFIX.length), value)
        count++
      } catch (e) {
        console.error('移行失敗:', key, e)
      }
    }
    setMigrating(false)
    setMigrateResult(`${count}件のデータをクラウドに移行しました。反映されたか確認したら、このブラウザのデータは消して構いません。`)
  }

  const addStaff = () => {
    if (!newName) return
    saveStaff({ id: `staff_${Date.now()}`, name: newName, hourlyWage: 1500, transport: 0 })
    setNewName('')
  }

  return (
    <div className="p-4 sm:p-6 max-w-xl">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">設定</h1>

      <div className="card mb-4">
        <div className="text-sm font-bold text-gray-600 mb-4">対象月</div>
        <input type="month" value={settings.targetMonth} onChange={e => saveSettings({ targetMonth: e.target.value })}
          className="input-cell w-48"/>
        <p className="text-xs text-gray-400 mt-2">ダッシュボード・支払い予定の集計対象月です</p>
      </div>

      <div className="card mb-4">
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-bold text-gray-600">予算（予実管理）</div>
          <div className="flex gap-1">
            <button onClick={() => setBudgetScope('default')}
              className={`px-2 py-1 rounded text-[11px] font-bold transition ${budgetScope === 'default' ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
              毎月の既定
            </button>
            <button onClick={() => setBudgetScope('month')}
              className={`px-2 py-1 rounded text-[11px] font-bold transition ${budgetScope === 'month' ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
              {targetMonth.replace('-', '年')}月だけ
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          金額は税込で入れてください（実績と同じ土俵で比較します）。0のままの項目は予実に表示されません
        </p>
        <BudgetEditor value={editingBudget} onPatch={onPatchBudget} onPatchExpense={onPatchBudgetExpense}
          month={targetMonth} isDefault={budgetScope === 'default'}/>
        {budgetScope === 'month' && budget.months?.[targetMonth] && (
          <button onClick={clearMonthOverride}
            className="mt-3 text-[11px] text-gray-400 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50">
            この月の個別設定を消して既定に戻す
          </button>
        )}
      </div>

      <div className="card mb-4">
        <div className="text-sm font-bold text-gray-600 mb-4">スタッフ台帳</div>
        <div className="space-y-2">
          {staff.map(m => (
            <div key={m.id} className="flex items-center gap-2">
              <input type="text" value={m.name} onChange={e => saveStaff({ ...m, name: e.target.value })}
                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"/>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-400">時給</span>
                <NumberInput value={m.hourlyWage} onChange={v => saveStaff({ ...m, hourlyWage: v })}
                  className="w-20 text-right text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"/>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-400">交通費</span>
                <NumberInput value={m.transport} onChange={v => saveStaff({ ...m, transport: v })}
                  className="w-20 text-right text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"/>
              </div>
              <button onClick={() => deleteStaff(m.id)} className="text-gray-300 hover:text-red-500 shrink-0">
                <Trash2 size={14}/>
              </button>
            </div>
          ))}
          {staff.length === 0 && <div className="text-xs text-gray-300">登録なし</div>}
        </div>
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
          <input type="text" placeholder="新しいスタッフ名" value={newName} onChange={e => setNewName(e.target.value)}
            className="flex-1 border border-dashed border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"/>
          <button onClick={addStaff} disabled={!newName}
            className="flex items-center gap-1 text-xs bg-gray-700 text-white px-3 py-1.5 rounded font-bold hover:bg-gray-800 transition disabled:opacity-30">
            <Plus size={14}/> 追加
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">「日次入力」の出勤スタッフ欄で選べる名前・時給・交通費の一覧です</p>
      </div>

      <div className="card mb-4">
        <div className="text-sm font-bold text-gray-600 mb-1">品目・仕入れ先マスタ</div>
        <p className="text-xs text-gray-400 mb-4">
          「日次入力」の仕入れ欄でプルダウンに出る選択肢です。品目に設定した消費税率は、その品目を選んだときに自動で入ります。
          ここで削除しても、過去に入力済みのデータは消えません
        </p>
        <div className="space-y-5">
          {LABEL_CATEGORIES.map(cat => (
            <div key={cat} className="border-t border-gray-100 pt-4 first:border-0 first:pt-0">
              <div className="text-sm font-bold text-gray-700 mb-2">{EXPENSE_CATEGORY_LABEL[cat]}</div>
              <div className="space-y-3">
                <VendorListEditor title="仕入れ先（大区分）" values={itemLabels.vendors[cat]}
                  onChange={next => updateLabels('vendors', cat, next)}/>
                <ItemListEditor defaultRate={DEFAULT_TAX_RATE[cat]} values={itemLabels.items[cat]}
                  onChange={next => saveItemLabels({ ...itemLabels, items: { ...itemLabels.items, [cat]: next } })}/>
              </div>
            </div>
          ))}
        </div>
      </div>

      {localKeys.length > 0 && (
        <div className="mt-8 card border border-blue-100">
          <div className="text-sm font-bold text-blue-600 mb-2">このブラウザに残っているデータをクラウドに移行</div>
          <p className="text-xs text-gray-400 mb-3">
            このブラウザ（端末）にまだ{localKeys.length}件のデータが残っています。クラウド（Supabase）に移行すると、スマホ・PCどちらからでも同じデータが見られるようになります。
          </p>
          <button onClick={migrateFromLocalStorage} disabled={migrating}
            className="flex items-center gap-1.5 text-xs bg-blue-700 text-white px-3 py-1.5 rounded font-bold hover:bg-blue-800 transition disabled:opacity-50">
            <UploadCloud size={14}/> {migrating ? '移行中…' : 'クラウドに移行する'}
          </button>
          {migrateResult && <p className="text-xs text-green-600 mt-2">{migrateResult}</p>}
        </div>
      )}

      <div className="mt-8 card border border-red-100">
        <div className="text-sm font-bold text-red-500 mb-2">データ管理</div>
        <p className="text-xs text-gray-400 mb-3">データはクラウド（Supabase）に保存されており、スマホ・PCどちらからでも同じデータにアクセスできます。</p>
        <button
          onClick={async () => {
            if (confirm('すべてのデータを削除しますか？この操作は取り消せません。')) {
              await supabase.from('birdmen_kv').delete().like('key', `${LOCAL_PREFIX}%`)
              window.location.reload()
            }
          }}
          className="text-xs text-red-400 border border-red-200 rounded px-3 py-1 hover:bg-red-50"
        >
          全データをリセット
        </button>
      </div>
    </div>
  )
}
