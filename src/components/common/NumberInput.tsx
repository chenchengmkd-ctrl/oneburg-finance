import { useEffect, useState } from 'react'

const fmtNum = (n: number) => n.toLocaleString('ja-JP')

// カンマ区切りで表示する数値入力（内部値はnumber、表示はライブでフォーマット）
export default function NumberInput({ value, onChange, className, placeholder = '0' }: {
  value: number; onChange: (v: number) => void; className?: string; placeholder?: string
}) {
  const [text, setText] = useState(value ? fmtNum(value) : '')

  // 外部から値が変わった場合（日付移動など）に表示を同期
  useEffect(() => {
    setText(value ? fmtNum(value) : '')
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '')
    const num = raw === '' ? 0 : Number(raw)
    setText(raw === '' ? '' : fmtNum(num))
    onChange(num)
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={text}
      onChange={handleChange}
      placeholder={placeholder}
      className={className}
    />
  )
}
