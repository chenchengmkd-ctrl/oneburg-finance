import { useEffect, useRef, useState } from 'react'
import { fmt, fmtShort } from '../../utils/calculations'
import { newLineItem, sumItems, sumNet, sumTax, taxRateOf, toNet, toGross } from '../../utils/storage'
import type { ExpenseCategory, LabelDef, LineItem, TaxRate } from '../../types'
import TaxAmountInput from './TaxAmountInput'
import { Plus, X, Pencil } from 'lucide-react'

// 経費入力（仕入れ先＞品目＞金額の3階層）。日次入力の中心なので、使い勝手はそのままに部品として切り出してある。
// 元は DailyEntry.tsx の中にあったものを、画面を作り直した際にここへ移した（2026-09）

// 選択肢がほぼ固まっている項目向け：普段はプルダウン選択、リストにないものだけ「＋ 新規入力」でその場で自由入力に切り替え
// 自由入力中は日本語入力（IME）の変換途中で親の再描画に巻き込まれないよう、ローカルのdraftを表示に使い確定後に親へ伝える
function PickField({ value, options, placeholder, addLabel, onChange, className }: {
  value: string; options: string[]; placeholder: string; addLabel: string; onChange: (v: string) => void; className: string
}) {
  const [customMode, setCustomMode] = useState(() => value !== '' && !options.includes(value))
  const [draft, setDraft] = useState(value)
  const composing = useRef(false)

  useEffect(() => { if (!composing.current) setDraft(value) }, [value])

  if (customMode) {
    return (
      <input type="text" value={draft} placeholder={placeholder} className={className} autoFocus
        onChange={e => {
          setDraft(e.target.value)
          if (!composing.current) onChange(e.target.value)
        }}
        onCompositionStart={() => { composing.current = true }}
        onCompositionEnd={e => {
          composing.current = false
          const v = (e.target as HTMLInputElement).value
          setDraft(v)
          onChange(v)
        }}/>
    )
  }
  return (
    <select value={value} onChange={e => {
      if (e.target.value === '__custom__') { setDraft(''); setCustomMode(true) }
      else onChange(e.target.value)
    }} className={className}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      <option value="__custom__">{addLabel}</option>
    </select>
  )
}

// 品目1行（品目名＋税率＋金額）。QuickItemsCardの外に置くことで、入力のたびに作り直されてフォーカスが外れるのを防ぐ
// 金額はレシートに書いてある税込を主に入力する（保存する`amount`も税込）。税抜は損益表示のために自動で計算する
function ItemRow({ item, labelDefs, onUpdate, onRemove }: {
  item: LineItem; labelDefs: LabelDef[]
  onUpdate: (patch: Partial<LineItem>) => void; onRemove: () => void
}) {
  const rate = taxRateOf(item)
  const net = toNet(item.amount, rate)

  // 品目を選び直したらマスタの税率も引き継ぐ（税抜額は保ったまま税込を再計算）
  const pickLabel = (name: string) => {
    const def = labelDefs.find(d => d.name === name)
    const nextRate = def ? def.taxRate : rate
    onUpdate({ label: name, taxRate: nextRate, amount: toGross(net, nextRate) })
  }
  const changeRate = (nextRate: TaxRate) => onUpdate({ taxRate: nextRate, amount: toGross(net, nextRate) })

  return (
    <div className="flex items-start gap-2">
      <PickField value={item.label} options={labelDefs.map(d => d.name)} placeholder="品目を選択" addLabel="＋ 新しい品目を入力"
        onChange={pickLabel}
        className="flex-1 min-w-0 text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-300 bg-white"/>
      <select value={rate} onChange={e => changeRate(Number(e.target.value) as TaxRate)}
        title="消費税率"
        className="w-14 shrink-0 text-[11px] text-gray-500 border border-gray-200 rounded px-1 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-300 bg-white">
        <option value={8}>8%</option>
        <option value={10}>10%</option>
        <option value={0}>非課税</option>
      </select>
      <div className="w-24 shrink-0">
        <TaxAmountInput gross={item.amount} rate={rate} onChange={amount => onUpdate({ amount })}/>
      </div>
      <button onClick={onRemove} className="text-gray-300 hover:text-red-500 shrink-0 mt-1.5"><X size={14}/></button>
    </div>
  )
}

// 仕入れ先1グループ。マスタ登録済み（pinned）の仕入れ先は名前を固定表示にし、品目の入力だけに集中できるようにする。
// マスタにない一時的な仕入れ先だけ名前を打ち替えられる
function VendorGroup({ vendor, items, pinned, vendorOptions, labelDefs, onAdd, onRename, onUpdate, onRemove }: {
  vendor: string; items: LineItem[]; pinned: boolean; vendorOptions: string[]; labelDefs: LabelDef[]
  onAdd: () => void; onRename: (v: string) => void
  onUpdate: (id: string, patch: Partial<LineItem>) => void; onRemove: (id: string) => void
}) {
  const net = sumNet(items)
  return (
    <div className={`border rounded-lg p-2 ${pinned ? 'border-gray-200 bg-white' : 'border-dashed border-gray-200 bg-gray-50'}`}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        {pinned
          ? <span className="text-sm font-bold text-gray-700 flex-1 truncate">{vendor || '（仕入れ先なし）'}</span>
          : <PickField value={vendor} options={vendorOptions} placeholder="仕入れ先を選択" addLabel="＋ 新しい仕入れ先を入力"
              onChange={onRename}
              className="text-sm font-bold text-gray-700 bg-transparent border-b border-dashed border-gray-300 focus:outline-none focus:border-gray-500 flex-1"/>}
        <span className="text-xs font-black text-gray-500 shrink-0">{net > 0 ? fmt(net) : '—'}</span>
      </div>
      {items.length > 0 && (
        <div className="space-y-1.5 pl-2">
          {items.map(item => (
            <ItemRow key={item.id} item={item} labelDefs={labelDefs}
              onUpdate={patch => onUpdate(item.id, patch)} onRemove={() => onRemove(item.id)}/>
          ))}
        </div>
      )}
      <button onClick={onAdd} className="text-[11px] text-gray-500 mt-1.5 pl-2 flex items-center gap-1 hover:text-gray-700">
        <Plus size={10}/> 品目を追加
      </button>
    </div>
  )
}

// 食材・備品などの仕入れ：仕入れ先（大区分）＞品目（中区分）＞金額（小区分）の3階層で入力
// マスタに登録した仕入れ先は毎日そのまま並ぶので、日々の入力は品目と金額を足すだけで済む
export default function ExpenseInput({ title, color, category, items, labelDefs, vendorOptions, pinnedVendors, onChange, hint, onEditMaster }: {
  title: string; color: string; category: ExpenseCategory
  items: LineItem[]; labelDefs: LabelDef[]; vendorOptions: string[]; pinnedVendors: string[]
  onChange: (items: LineItem[]) => void; hint?: string; onEditMaster: () => void
}) {
  const total = sumItems(items)
  const netTotal = sumNet(items)
  const taxTotal = sumTax(items)
  const update = (id: string, patch: Partial<LineItem>) => onChange(items.map(i => i.id === id ? { ...i, ...patch } : i))
  const remove = (id: string) => onChange(items.filter(i => i.id !== id))
  const addFlat = () => onChange([...items, newLineItem(category)])
  const addVendorGroup = () => onChange([...items, newLineItem(category, '')])
  const addToVendor = (vendor: string) => onChange([...items, newLineItem(category, vendor)])
  // vendor未設定（＝仕入れ先グループに属さない単独の品目）は対象外。`?? ''`で比較すると空名グループに巻き込まれる
  const renameVendor = (oldVendor: string, newVendor: string) =>
    onChange(items.map(i => i.vendor !== undefined && i.vendor === oldVendor ? { ...i, vendor: newVendor } : i))

  const flatItems = items.filter(i => i.vendor === undefined)
  // マスタの仕入れ先は品目が無くても常に枠を出す。マスタに無い仕入れ先だけ後ろに続ける
  const byVendor = new Map<string, LineItem[]>()
  const adhocOrder: string[] = []
  for (const item of items) {
    if (item.vendor === undefined) continue
    if (!byVendor.has(item.vendor)) {
      byVendor.set(item.vendor, [])
      if (!pinnedVendors.includes(item.vendor)) adhocOrder.push(item.vendor)
    }
    byVendor.get(item.vendor)!.push(item)
  }

  return (
    <div className="card mb-4">
      <div className={`flex items-start justify-between ${hint ? 'mb-1' : 'mb-3'}`}>
        <span className={`text-sm font-bold ${color}`}>{title}</span>
        <div className="text-right">
          <div className={`text-lg font-black ${color}`}>{fmt(total)}</div>
          <div className="text-[10px] text-gray-400">税込 ／ 税抜 {fmtShort(netTotal)}（消費税 {fmtShort(taxTotal)}）</div>
        </div>
      </div>
      {hint && <p className="text-[11px] text-gray-400 mb-2">{hint}</p>}

      {flatItems.length > 0 && (
        <div className="space-y-2 mb-2">
          {flatItems.map(item => (
            <ItemRow key={item.id} item={item} labelDefs={labelDefs}
              onUpdate={patch => update(item.id, patch)} onRemove={() => remove(item.id)}/>
          ))}
        </div>
      )}

      <div className="space-y-2 mb-2">
        {pinnedVendors.map(vendor => (
          <VendorGroup key={vendor} vendor={vendor} items={byVendor.get(vendor) ?? []} pinned
            vendorOptions={vendorOptions} labelDefs={labelDefs}
            onAdd={() => addToVendor(vendor)} onRename={() => {}}
            onUpdate={update} onRemove={remove}/>
        ))}
        {adhocOrder.map(vendor => {
          const groupItems = byVendor.get(vendor)!
          return (
            // 名前を打ち替えても行が作り直されないよう、キーには名前ではなく先頭の明細IDを使う
            <VendorGroup key={groupItems[0].id} vendor={vendor} items={groupItems} pinned={false}
              vendorOptions={vendorOptions} labelDefs={labelDefs}
              onAdd={() => addToVendor(vendor)} onRename={v => renameVendor(vendor, v)}
              onUpdate={update} onRemove={remove}/>
          )
        })}
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <button onClick={addFlat} className="text-xs text-gray-600 flex items-center gap-1 hover:text-gray-800">
          <Plus size={12}/> 仕入れ先なしで品目を追加
        </button>
        <button onClick={addVendorGroup} className="text-xs text-gray-600 flex items-center gap-1 hover:text-gray-800">
          <Plus size={12}/> 今回だけの仕入れ先
        </button>
        <button onClick={onEditMaster} className="text-xs text-gray-400 flex items-center gap-1 hover:text-gray-600 ml-auto">
          <Pencil size={11}/> 仕入れ先を編集
        </button>
      </div>
    </div>
  )
}
