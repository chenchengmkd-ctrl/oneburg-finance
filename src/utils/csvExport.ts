// テーブルデータをCSVファイルとしてダウンロードする（Excel/Googleスプレッドシートで開ける形式）
export const downloadCsv = (filename: string, rows: (string | number)[][]) => {
  const csv = rows
    .map(row => row.map(cell => {
      const s = String(cell)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }).join(','))
    .join('\r\n')
  // 先頭にBOMを付けてExcelで文字化けしないようにする
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
