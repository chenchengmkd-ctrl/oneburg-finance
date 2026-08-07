// 初期設定
export interface Settings {
  targetMonth: string          // 管理対象月 YYYY-MM
}

// 借入・立替金（返済対象）
export interface Loan {
  id: string
  lender: string        // 借入・立替先
  borrowedDate: string  // 借入日（不明なら空文字）
  totalAmount: number   // 借入・立替総額
  paidAmount: number    // 返済済み累計（手動更新）
  priority: 'high' | 'medium' | 'low'
  note: string
}

// 資金繰り予定の分類
// fixed: 毎月同じ日・同じ金額（家賃、サブスク、バイト給与など）
// variable: 毎月ほぼ同じ日・金額は変動（光熱費、社員給与、仕入、現金売上見込みなど）
// adhoc: 不定期・都度発生（借入返済、臨時の立替返却、単発の入金見込みなど）
export type PaymentCategory = 'fixed' | 'variable' | 'adhoc'

// in: 収入予定（バイト入金、現金売上見込みなど）/ out: 支出予定（家賃、仕入など）
export type PaymentDirection = 'in' | 'out'

export interface ScheduledPayment {
  id: string
  name: string
  category: PaymentCategory
  direction: PaymentDirection
  amount: number                    // fixed=確定額 / variable・adhoc=見込み額
  bucket: 'corp' | 'pers' | 'cash'  // どの残高が動くか
  dayOfMonth: number | null         // fixed・variable: 毎月の予定日（1-31）
  dueDate: string | null            // adhoc: 具体的な予定日 YYYY-MM-DD（未定ならnull）
  linkedLoanId: string | null       // adhoc: 借入返済に紐づく場合、対象のLoan.id
  note: string
  active: boolean                   // falseで一覧から非表示（削除せず保持）
}

// 支出の分類（損益表の費用内訳に使う。引出明細に付ける。収入側では未使用）
export type ExpenseCategory = 'ingredient' | 'supplies' | 'labor' | 'rent' | 'utility' | 'other'

// 消費税率（%）。0=不課税・非課税（人件費など）、8=軽減税率（食材）、10=標準税率
export type TaxRate = 0 | 8 | 10

// カテゴリ別の既定税率（品目マスタに税率がない場合のフォールバック）
export const DEFAULT_TAX_RATE: Record<ExpenseCategory, TaxRate> = {
  ingredient: 8,
  supplies:   10,
  labor:      0,
  rent:       10,
  utility:    10,
  other:      10,
}

// 品目マスタ1件（名前＋その品目の消費税率）
export interface LabelDef {
  name: string
  taxRate: TaxRate
}

// 予算（予実管理）。金額はすべて税込＝実績（LineItem.amount）と同じ土俵で比較する
// 曜日別を入れた場合は「曜日別 × その月の該当曜日数」を積み上げて月次目標にする（曜日別が優先）
export interface MonthBudget {
  revenue: number                             // 月の売上目標（曜日別が未設定のときに使う）
  dailyRevenue: number                        // 1日あたりの売上目標（0なら月次目標÷その月の日数）
  weekdayRevenue: number[]                    // 曜日別の売上目標。index 0=日 … 6=土。全部0なら未設定
  weekdayLabor: number[]                      // 曜日別の人件費予算。index 0=日 … 6=土。全部0なら未設定
  expenses: Record<ExpenseCategory, number>   // カテゴリ別の月次費用予算（laborは曜日別が入っていればそちらが優先）
}

// default＝毎月の既定値、months＝特定月だけの上書き（例：12月は売上目標を上げる）
export interface BudgetSet {
  default: MonthBudget
  months: Record<string, Partial<MonthBudget>>
}

// 仕入れ先・品目の候補マスタ（カテゴリ別。設定画面で編集可能）
export interface ItemLabelSet {
  vendors: Record<ExpenseCategory, string[]>
  items: Record<ExpenseCategory, LabelDef[]>
}

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  ingredient: '食品仕入',
  supplies:   '備品仕入',
  labor:      '人件費',
  rent:       '家賃',
  utility:    '水道光熱費',
  other:      'その他経費',
}

// 入金・引出の明細1行（複数行入力に対応するため）
// amountは常に「税込（実際に支払った額）」で保持する。残高計算・損益はこの値をそのまま使う。
// 税抜額はtaxRateから逆算して表示する（入力欄は税抜だが、保存されるのは税込）
export interface LineItem {
  id: string
  label: string
  amount: number               // 税込金額
  category?: ExpenseCategory   // 引出のみ使用。未設定は'other'扱い
  vendor?: string              // 仕入れ先（大区分）。未設定＝仕入れ先グループなしのフラット項目として扱う
  taxRate?: TaxRate            // 未設定はカテゴリ既定（DEFAULT_TAX_RATE）を使う
}

// 残高報告：口座バケット（GMO個人・GMO法人）
export interface BucketDay {
  prevOverride: number | null    // 昨日残の手動上書き（初日・補正用。nullなら前日から自動）
  deposits: LineItem[]           // 入金（複数明細）
  withdraws: LineItem[]          // 引出・支払（複数明細）
  balanceOverride: number | null // 残高目安の実測上書き（nullなら自動計算）
}

// 残高報告：現金バケット（屋台うなぎ現金、レジ金除く）
export interface CashDay extends BucketDay {
  sales: number      // 本日現金売上
  salesNote: string
  toBank: number     // 銀行入金（現金→法人口座。法人残高へ自動反映）
}

// 残高報告：見込み項目（毎日前日から引き継ぎ・編集可）
export interface ReportPending {
  persExpected: number  // GMO個人 入金予定
  corpSquare: number    // スクエア入金予定
  cashReturn: number    // 今後返却予定
}

// スタッフ台帳（名前・時給・1回の出勤あたりの交通費）
export interface Staff {
  id: string
  name: string
  hourlyWage: number
  transport: number  // 1回の出勤あたりの交通費
}

// シフトの曜日パターン（「毎週土曜は都丸が10:00〜15:00」のような定型）
// これを月にまとめて適用してシフト表を一気に作る
export interface ShiftPatternEntry {
  id: string
  staffName: string
  clockIn: string
  clockOut: string
}

// index 0=日 … 6=土
export type ShiftPattern = Record<number, ShiftPatternEntry[]>

// 出勤シフト1件（誰が・何時から何時まで働いたか）
// 労働時間はclockIn/clockOutから自動計算、日給 = 時間 × hourlyWage + transport
export interface ShiftEntry {
  id: string
  staffName: string
  clockIn: string   // "HH:MM"（未入力は空文字）
  clockOut: string  // "HH:MM"
  hourlyWage: number
  transport: number
}

// 日次残高報告（毎日の報告そのもの）
export interface BalanceReport {
  date: string // YYYY-MM-DD
  pers: BucketDay
  corp: BucketDay
  cash: CashDay
  pending: ReportPending
  shifts: ShiftEntry[]  // その日の出勤シフト（人件費の内訳）
  note: string
}

// 残高報告の計算結果（1日分）
export interface ReportDay {
  date: string
  persPrev: number
  persBal: number
  corpPrev: number
  corpBal: number
  cashPrev: number
  cashBal: number
  totalBal: number   // 3残高合計
  realBal: number    // 実質総資産 = 合計 + スクエア予定 + 入金予定 − 返却予定
  report: BalanceReport
}
