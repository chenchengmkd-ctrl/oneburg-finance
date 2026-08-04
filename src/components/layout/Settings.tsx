import { useEffect, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { storage } from '../../utils/storage'
import { supabase } from '../../utils/supabaseClient'
import NumberInput from '../common/NumberInput'
import { Plus, Trash2, UploadCloud } from 'lucide-react'

const LOCAL_PREFIX = 'birdmen:'

export default function Settings() {
  const { settings, staff, loadSettings, saveSettings, loadStaff, saveStaff, deleteStaff } = useAppStore()
  const [newName, setNewName] = useState('')
  const [migrating, setMigrating] = useState(false)
  const [migrateResult, setMigrateResult] = useState<string | null>(null)
  const localKeys = Object.keys(localStorage).filter(k => k.startsWith(LOCAL_PREFIX))

  useEffect(() => { loadSettings(); loadStaff() }, [])

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
