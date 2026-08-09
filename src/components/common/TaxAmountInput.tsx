import NumberInput from './NumberInput'
import { toNet, toGross } from '../../utils/storage'
import type { TaxRate } from '../../types'

// 税抜・税込のどちらからでも入力できる金額欄。
// 損益は税抜ベースで見るので税抜を主として上に置くが、レシートに税込しか書いていないことも多いため
// 税込欄も直接編集できるようにしてある。保存値（LineItem.amount / cash.sales）は常に税込＝実際に動いたお金。
export default function TaxAmountInput({ gross, rate, onChange, size = 'sm' }: {
  gross: number; rate: TaxRate; onChange: (gross: number) => void; size?: 'sm' | 'lg'
}) {
  const net = toNet(gross, rate)
  const big = size === 'lg'
  const box = big
    ? 'w-full text-right text-2xl font-bold pl-12 pr-4 py-3 border-2 border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400'
    : 'w-full text-right text-sm pl-8 pr-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-gray-300'
  const tag = `absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 ${big ? 'text-xs' : 'text-[9px]'}`

  // 非課税なら税抜＝税込なので1欄だけにする
  if (rate === 0) {
    return (
      <div className="relative">
        <span className={tag}>税抜</span>
        <NumberInput value={gross} onChange={onChange} className={box}/>
      </div>
    )
  }

  return (
    <div className={big ? 'space-y-2' : 'space-y-1'}>
      <div className="relative">
        <span className={tag}>税抜</span>
        <NumberInput value={net} onChange={v => onChange(toGross(v, rate))} className={box}/>
      </div>
      <div className="relative">
        <span className={tag}>税込</span>
        <NumberInput value={gross} onChange={onChange}
          className={`${box} ${big ? 'text-gray-500 !text-lg !py-2' : 'text-gray-500'}`}/>
      </div>
    </div>
  )
}
