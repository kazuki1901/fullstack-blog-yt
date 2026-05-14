# 送り状システム 設計ドキュメント

> 作成日: 2026-05-09
> 対象: 大阪北陸急配株式会社 向け外販案(同種の地域路線会社へも展開可能なマルチテナント前提)
> 関連ナレッジ: プロジェクト内 `osakaHokurikuKyuhai.md` / `osakaHokurikuVsCompetitors.md` / `送り状システム設計_全体構造.md`(本書とは別資料。差分は §14 に追記予定)
> ステータス: ドラフト v0.1(設計のみ。実装は未着手)

---

## 0. 用語

| 略語 | 意味 |
|---|---|
| 送り状(Waybill) | 1 件の輸送依頼。1 送り状 = 1 口 or 複数口 |
| 追跡番号(Tracking No) | 送り状を一意に識別する人間可読 ID。QR の中身 |
| タッチポイント | 送り状が物理的に動く節目(集荷・積込・中継・到着・出発・納品) |
| ハブ(Hub) | 営業所・中継所・配達店 |
| 早朝便 | AM5:00〜8:00 の北陸 3 県向け配達(同社の主力サービス) |

---

## 1. ドキュメントの目的

- 大阪北陸急配(以下、同社)向け **送り状システム** の全体構造を定義する
- 既存の QR スキャナ資産(`/qr` 単発, `/qr-multi` 複数同時)を、業務フローのどこに、どう接続するかを明確にする
- 外販を想定し、**マルチテナント** で他社展開可能な構造を確保する
- 本書はコード実装の前段。Prisma schema・API・画面構造の合意を取るための下敷き

非目標(本書では扱わない):
- ドライバー勤怠・労務管理
- 運賃計算・請求(将来 §14 オープン論点)
- WMS / 在庫管理(別領域)

---

## 2. 提案のコア訴求(同社特性とのフィット)

| 同社の課題 | 本システムでの解 |
|---|---|
| 公式サイトに **Web 追跡 UI がない** → 荷主の DX 要求に追随できない | 公開追跡ページ + 荷主向け Webhook/CSV 連携 |
| 早朝便で AM8 までに 1,000 件 → 紙の完了報告は限界 | スキャン即ステータス確定、配車係 PC でリアルタイム可視化 |
| 中継所 6 箇所(敦賀/豊橋/岐阜/浜松/静岡/沼津)で多段積み替え | 各タッチポイントで QR スキャン → 「どこで止まっているか」が即わかる |
| 協力会社車両 ~150 台で品質統制が難しい | スマホ Web アプリ(PWA)で端末配布不要、協力会社にも即展開 |
| 独立系で機動力あり = カスタム要件に応えやすい | テナント単位でカスタムを保ち、外販時の本体改修を抑える |

---

## 3. ステークホルダーと役割

| ロール | 主な行動 | 主な画面 |
|---|---|---|
| **荷主(Shipper)** | 送り状発行、追跡、CSV 一括取込、Webhook 受信 | `/shipper/*` |
| **集荷ドライバー** | 集荷先で QR 読込・撮影・サイン取得 | `/ops/pickup` |
| **営業所オペレーター** | 仕分け・積込・中継引継 | `/ops/hub/[hubId]` |
| **配達ドライバー** | 配達車積込・お届け・受領サイン | `/ops/delivery` |
| **配車係/管理者** | リアルタイム可視化、例外対応、KPI | `/ops/dashboard`, `/admin/*` |
| **受取人(Consignee)** | 公開追跡ページの閲覧(認証なし、URL/QR 経由) | `/track/[code]` |
| **テナント管理者** | ハブ・ユーザー・サービス料金設定 | `/admin/tenant` |

---

## 4. 送り状ライフサイクルと QR タッチポイント

### 4.1 状態遷移

```
CREATED ──集荷──▶ PICKED_UP ──元営業所積込──▶ IN_TRANSIT
                                                    │
                                              中継所通過
                                                    │
                                                    ▼
                                              ARRIVED_HUB
                                                    │
                                              配達車積込
                                                    │
                                                    ▼
                                            OUT_FOR_DELIVERY
                                                    │
                                                  納品
                                                    │
                                                    ▼
                                              DELIVERED

  例外: 任意の状態 → EXCEPTION(破損/不在/誤配等)
       任意の状態 → RETURNED(返品)
```

### 4.2 タッチポイントとスキャナ使い分け

| # | タッチポイント | 主な担当 | 端末 | スキャナ | 発火イベント | 想定件数/朝 |
|---|---|---|---|---|---|---|
| ① | 集荷 | 集荷ドライバー | スマホ | [/qr](../app/qr/page.tsx)(単発) | `PICKED_UP` | ~数百 |
| ② | 元営業所 積込 | 大阪本社オペレーター | タブレット | [/qr-multi](../app/qr-multi/page.tsx) | `LOADED`(車両 ID 紐付け) | 1000+ |
| ③ | 中継所 積み替え | 中継所オペレーター | タブレット | `/qr-multi` | `TRANSIT_IN` / `TRANSIT_OUT` | 数百〜千 |
| ④ | 配達店 到着 | 配達店オペレーター | タブレット | `/qr-multi` | `ARRIVED` | 数百 |
| ⑤ | 配達車 積込 | 配達ドライバー | スマホ | `/qr-multi`(カゴ車一気) | `OUT_FOR_DELIVERY` | 数十/車 |
| ⑥ | 納品 | 配達ドライバー | スマホ | `/qr` + 受領サイン | `DELIVERED` | 1 件ずつ |

> 設計指針: **複数同時** は積込/積み替え/到着のような「束で動く局面」、**単発** は集荷/納品のような「人と対面する局面」。

---

## 5. システム全体構成

> UI モックアップ(全クライアント統合・1 ファイルで開ける提出用資料):
> [proposal.html](proposal.html) — 表紙 + 5 セクション(追跡 A/B、荷主ポータル、現場アプリ、管理)


```
┌────────────────────────────────────────────────────────────┐
│ クライアント(全部 Web、PWA でホーム追加)                  │
│  ・荷主ポータル(送り状発行・追跡・CSV 取込)                │
│  ・現場アプリ(ドライバー/オペレーター) ← 既存 QR 資産     │
│  ・配車・管理ダッシュボード                                  │
│  ・受取人向け公開追跡ページ                                  │
└─────────────────────┬──────────────────────────────────────┘
                      │ HTTPS / Server Actions / API
┌─────────────────────▼──────────────────────────────────────┐
│ Next.js 16 App Router(本リポジトリ構成を踏襲)             │
│  app/                                                        │
│   shipper/        荷主ポータル                              │
│   ops/            現場・配車                                │
│   admin/          テナント管理                              │
│   track/[code]/   公開追跡ページ                            │
│   api/waybills/   送り状 CRUD                               │
│   api/scan/       タッチポイント打刻(★QR の受け先)         │
│   api/webhooks/   荷主向け配信                              │
│   api/csv/        CSV 取込/出力                             │
└─────────────────────┬──────────────────────────────────────┘
                      │ Prisma 7 (driver adapter / pg)
┌─────────────────────▼──────────────────────────────────────┐
│ PostgreSQL                                                   │
│  Tenant / User / Customer / Hub / Vehicle                    │
│  Waybill / WaybillItem                                       │
│  ScanEvent(append-only / 追跡履歴の真実)                   │
│  Webhook / WebhookDelivery                                   │
└────────────────────────────────────────────────────────────┘
                      │
                      ▼ 帳票・印刷
            送り状 PDF + QR(@react-pdf/renderer)
            将来: 熱転写プリンタ向け ZPL 出力
```

技術選定の前提(本リポジトリ既存):
- Next.js 16 App Router / React 19 / Prisma 7(driver adapter 必須)/ PostgreSQL / TailwindCSS v4
- QR 読取: `html5-qrcode`(単発)/ `BarcodeDetector` API(複数)
- 認証: 初期は Basic、α 以降で NextAuth(オペレーターはハブ ID + PIN を許容)

---

## 6. データモデル(Prisma 7 schema 案)

```prisma
// マルチテナント基盤
model Tenant {
  id        String   @id @default(cuid())
  code      String   @unique         // "ohk" = 大阪北陸急配
  name      String
  createdAt DateTime @default(now())
  hubs      Hub[]
  waybills  Waybill[]
  users     User[]
}

model User {
  id        String   @id @default(cuid())
  tenantId  String
  loginId   String                    // ハブごとの共有 ID も許容
  name      String
  role      UserRole                  // ADMIN / DISPATCHER / OPERATOR / DRIVER / SHIPPER
  hubId     String?                   // オペレーター/配達は所属ハブ固定
  active    Boolean  @default(true)
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  hub       Hub?     @relation(fields: [hubId], references: [id])
  @@unique([tenantId, loginId])
}

model Hub {
  id       String  @id @default(cuid())
  tenantId String
  code     String                     // "OSAKA" "TSURUGA" "KANAZAWA"
  name     String
  type     HubType                    // ORIGIN / TRANSFER / DELIVERY
  tenant   Tenant  @relation(fields: [tenantId], references: [id])
  @@unique([tenantId, code])
}

model Vehicle {
  id        String  @id @default(cuid())
  tenantId  String
  plateNo   String                    // 車両ナンバー
  capacity  String?                   // "10t" "4t" "1BOX"
  partner   String?                   // 協力会社名(自社は null)
  @@unique([tenantId, plateNo])
}

// 顧客マスタ
model Customer {
  id       String  @id @default(cuid())
  tenantId String
  type     CustomerType                // SHIPPER / CONSIGNEE
  code     String?                     // 荷主コード
  name     String
  address  String
  tel      String?
  @@index([tenantId, type])
}

// 送り状
model Waybill {
  id            String   @id @default(cuid())
  tenantId      String
  trackingNo    String   @unique       // QR 化対象。例 "OHK-20260509-000123"
  shipperId     String                 // 発荷主(Customer)
  consigneeName String
  consigneeAddr String
  consigneeTel  String
  serviceType   ServiceType            // EARLY_MORNING / TOP / NORMAL / TIME_SPEC
  desiredDate   DateTime
  desiredSlot   String?                // "AM" "08-10" 等
  pieces        Int      @default(1)   // 口数
  weightKg      Decimal?
  status        WaybillStatus @default(CREATED)
  currentHubId  String?                // 派生キャッシュ。真実は ScanEvent
  createdAt     DateTime @default(now())
  events        ScanEvent[]
  items         WaybillItem[]
  @@index([tenantId, status])
  @@index([tenantId, desiredDate])
}

model WaybillItem {              // 1 送り状複数口の口別
  id         String @id @default(cuid())
  waybillId  String
  pieceNo    Int                       // 1, 2, 3 ...
  pieceCode  String  @unique           // "OHK-...-001-1" QR 化対象
  weightKg   Decimal?
  waybill    Waybill @relation(fields: [waybillId], references: [id])
  @@unique([waybillId, pieceNo])
}

// ★追跡の真実。append-only。
model ScanEvent {
  id           String   @id @default(cuid())
  tenantId     String
  waybillId    String
  trackingNo   String                  // 非正規化(オフライン投入時の冪等性確保)
  pieceCode    String?                 // 口別スキャン時
  eventType    EventType
  hubId        String?
  vehicleId    String?
  operatorId   String
  scannedAt    DateTime                // 端末時刻(オフライン後送り対応)
  receivedAt   DateTime @default(now())// サーバー受信時刻
  geo          Json?                   // { lat, lng } 任意
  note         String?
  signatureUrl String?                 // 受領サイン(DELIVERED のみ)
  idempotencyKey String                // (trackingNo + eventType + hubId + clientUuid)
  waybill      Waybill  @relation(fields: [waybillId], references: [id])
  @@unique([idempotencyKey])
  @@index([trackingNo])
  @@index([waybillId, scannedAt])
}

// 荷主向け Webhook
model Webhook {
  id        String @id @default(cuid())
  tenantId  String
  shipperId String                     // 配信先の荷主
  url       String
  secret    String
  events    String[]                   // ["DELIVERED", "EXCEPTION"]
  active    Boolean @default(true)
}

model WebhookDelivery {
  id          String   @id @default(cuid())
  webhookId   String
  payload     Json
  status      Int?                      // HTTP status
  attempts    Int      @default(0)
  lastTriedAt DateTime?
  succeededAt DateTime?
}

enum UserRole       { ADMIN DISPATCHER OPERATOR DRIVER SHIPPER }
enum HubType        { ORIGIN TRANSFER DELIVERY }
enum CustomerType   { SHIPPER CONSIGNEE }
enum ServiceType    { EARLY_MORNING TOP NORMAL TIME_SPEC }
enum WaybillStatus  { CREATED PICKED_UP IN_TRANSIT ARRIVED_HUB OUT_FOR_DELIVERY DELIVERED RETURNED EXCEPTION }
enum EventType      { PICKED_UP LOADED TRANSIT_IN TRANSIT_OUT ARRIVED OUT_FOR_DELIVERY DELIVERED EXCEPTION }
```

設計上の重要な決定:
- `Waybill.status` は **`ScanEvent` から導出される派生値**。真実はイベントログ。誤スキャンの取消も差分イベントで表現(物流監査・荷主への説明責任に対応)
- `scannedAt`(端末時刻) と `receivedAt`(サーバー時刻) を分離 → オフライン後送りでも順序が崩れない
- `idempotencyKey` で同一スキャンの二重打刻を弾く → qr-multi の連続発火に必須
- `pieceCode` で 1 送り状複数口に対応 → §14 の論点を吸収

---

## 7. API 設計

### 7.1 認証
- 現場系:`Authorization: Bearer <token>`(オペレーターはハブ ID + PIN で発行)
- 荷主系:NextAuth(初期は Email/Password、将来 OIDC)
- 公開追跡:認証なし、`trackingNo` + `consigneeTel` 下 4 桁で個人情報マスク制御

### 7.2 主要エンドポイント

```
# 送り状
POST   /api/waybills                      送り状新規発行
GET    /api/waybills/[trackingNo]         単体取得(イベント履歴含む)
GET    /api/waybills?status=&date=        一覧/検索
POST   /api/waybills/csv                  CSV 一括取込

# スキャン打刻(★QR の受け先)
POST   /api/scan                          { events: ScanEventInput[] }  ←バッチ前提
  request:
    {
      "events": [
        {
          "trackingNo": "OHK-20260509-000123",
          "pieceCode": null,
          "eventType": "LOADED",
          "hubId": "TSURUGA",
          "vehicleId": "veh_abc",
          "scannedAt": "2026-05-09T03:11:22.000Z",
          "geo": { "lat": 35.66, "lng": 136.07 },
          "clientUuid": "f3a1..."     // 冪等キー素材
        }
      ]
    }
  response:
    {
      "results": [
        { "trackingNo": "...", "result": "OK", "newStatus": "IN_TRANSIT" },
        { "trackingNo": "...", "result": "DUPLICATE" },
        { "trackingNo": "...", "result": "UNKNOWN" }
      ]
    }

# 公開追跡
GET    /track/[trackingNo]                公開追跡 HTML(SSR)
GET    /api/track/[trackingNo]            JSON

# 配車・管理
GET    /api/ops/dashboard/stream          SSE: 配車ダッシュボード用
GET    /api/admin/kpi                     KPI 集計

# Webhook
POST   /api/webhooks/test                 配信テスト
```

判定ルール(`/api/scan` 内部):

| 状況 | 結果 |
|---|---|
| `trackingNo` がマスタに無い | `UNKNOWN` |
| 同一 `idempotencyKey` で既存 | `DUPLICATE`(成功扱い、無視) |
| 状態遷移として不整合(例:`DELIVERED` 後に `LOADED`) | `INVALID_TRANSITION`、サーバーログに残し管理者確認 |
| 正常 | `OK` + 新ステータス返却 |

---

## 8. 画面・URL マップ

| ルート | 概要 | 主な利用者 |
|---|---|---|
| `/shipper` | 荷主ダッシュボード(本日発行・配達状況) | 荷主 |
| `/shipper/waybills/new` | 送り状新規発行(単票) | 荷主 |
| `/shipper/waybills/import` | CSV 一括取込 | 荷主 |
| `/shipper/waybills/[trackingNo]` | 詳細・追跡履歴 | 荷主 |
| `/shipper/webhooks` | Webhook 設定 | 荷主管理者 |
| `/ops/pickup` | 集荷スキャン(単発 + 写真 + 受領印) | 集荷ドライバー |
| `/ops/hub/[hubId]` | ハブ作業ハブ(積込/積み替え選択) | ハブオペレーター |
| `/ops/hub/[hubId]/load` | 車両指定 → qr-multi 一括積込 | ハブオペレーター |
| `/ops/hub/[hubId]/transit` | 中継所 IN/OUT 切替 → qr-multi | 中継所オペレーター |
| `/ops/hub/[hubId]/arrive` | 到着スキャン → qr-multi | 配達店オペレーター |
| `/ops/delivery` | 配達ドライバー Today。スキャンで `OUT_FOR_DELIVERY` → 個別納品 | 配達ドライバー |
| `/ops/dashboard` | リアルタイム配車盤(SSE) | 配車係 |
| `/admin/tenant` | テナント・ハブ・ユーザー管理 | テナント管理者 |
| `/admin/exceptions` | 例外管理(不在/破損/誤配) | 配車係 |
| `/admin/kpi` | KPI(早朝便達成率・遅延率・再配達率) | 経営/管理 |
| `/track/[trackingNo]` | 公開追跡ページ | 受取人 |

### 8.1 検品/積込メイン画面ワイヤフレーム(`/ops/hub/[hubId]/load`)

```
┌──────────────────────────────────────────────────────────┐
│ 大阪営業所 / 積込  車両: 大阪 580 あ 12-34 [変更]         │
├──────────────────────────────────────────────────────────┤
│ ┌─────────────────────┐  ┌────────────────────────────┐ │
│ │                     │  │ 積込予定  3 / 12 件         │ │
│ │   [カメラ映像]       │  │ ─────────────────────────── │ │
│ │   qr-multi          │  │ ✓ OHK-...000121  早朝       │ │
│ │   緑=確定 黄=暫定    │  │ ✓ OHK-...000122  早朝       │ │
│ │   LIVE · 4          │  │ ✓ OHK-...000123  TOP        │ │
│ │                     │  │   OHK-...000124  早朝       │ │
│ │                     │  │   OHK-...000125  通常       │ │
│ │                     │  │   ...                      │ │
│ └─────────────────────┘  └────────────────────────────┘ │
│ [一括送信(3件)] [積込完了 → 出発]                       │
└──────────────────────────────────────────────────────────┘
```

---

## 9. 既存 QR 資産の活かし方

### 9.1 現状資産の評価

| 資産 | 強み | 拡張ポイント |
|---|---|---|
| [/qr](../app/qr/page.tsx) | シンプルで誤動作少ない、`html5-qrcode` で対応端末が広い | 写真撮影・受領サイン入力の追加 |
| [/qr-multi](../app/qr-multi/page.tsx) | `BarcodeDetector` 直叩き、5 フレーム確定で誤読耐性、ビープ/バイブ | 確定済み配列を **バッチ POST** に流す導線、結果(緑=OK / 赤=NG)反映 |

### 9.2 接続点

```
[MultiQrScanner.confirmed (state)]
        │
        ▼
[useScanQueue]   ← オフライン時は IndexedDB に積む
        │
        ▼
POST /api/scan { events: [...] }
        │
        ▼
[サーバー判定: OK / DUPLICATE / UNKNOWN / INVALID_TRANSITION]
        │
        ▼
[結果を行ハイライト、NG はビープ低音 + バイブ長め]
```

`MultiQrScanner` 側は、判定結果を受けて行の色を変えるための `onResult(text, result)` コールバックを追加する程度で済む(コンポーネント内部の確定ロジックには手を入れない)。

---

## 10. 非機能要件

### 10.1 オフライン
- 現場アプリは **PWA**(Service Worker + IndexedDB)
- スキャンは即サーバー POST を試み、失敗時はキューに溜め、復帰時にバッチ送信
- 送り状マスタは前夜にハブごとの本日分を端末プリフェッチ → 圏外でも `UNKNOWN` 判定をクライアントで先行表示

### 10.2 冪等性
- クライアントは 1 スキャンに `clientUuid` を発行
- サーバーは `(tenantId, trackingNo, eventType, hubId, clientUuid)` を `idempotencyKey` として一意制約
- 二重 POST は `DUPLICATE` で成功扱い

### 10.3 スループット(早朝便対応)
- ピーク見積:AM5-8 の 3 時間で 1,000 件配達 + 各タッチポイントで 1〜3 回スキャン → ~3,000-5,000 イベント/朝
- `/api/scan` はバッチ受け(1 リクエスト ≦ 100 件)、Prisma `createMany` で投入
- 配車ダッシュボードは Server-Sent Events(SSE)で 1 秒粒度

### 10.4 セキュリティ
- HTTPS 必須(BarcodeDetector / getUserMedia の制約とも合致)
- API レスポンスにスタックトレース・SQL を出さない([AGENTS.md](../AGENTS.md) の規約踏襲)
- 公開追跡は `trackingNo` だけでは個人情報フル開示しない(住所は丁目までマスクなど)
- マルチテナント:全テーブルに `tenantId`、Server Action / Route Handler で必ず JWT の `tenantId` でフィルタ

### 10.5 監査
- `ScanEvent` は append-only、論理削除も不可。誤スキャンは取消イベントを追加
- 90 日以上前のイベントは Cold Storage(別テーブル/別 DB)へ移送(将来)

---

## 11. マルチテナント設計

- 同社(`tenant.code = "ohk"`)を最初のテナントとしてセットアップ
- 全主要モデルに `tenantId` を持たせ、Prisma の Row-Level に近い扱いをアプリ層で強制
- ハブ・サービス区分・追跡番号フォーマットはテナントごとに設定可能(`Tenant.config Json`)
- 外販時は `npm run seed:tenant -- --code=xxx` の単一コマンドで初期化できることを目標

---

## 11.5 位置情報サービス(スキャン時位置)

西濃運輸の追跡画面のような「現在地が見える」体験を、**スキャン時 GPS スナップショット**で提供する。低コスト・低リスクで Web 追跡なし問題を解消できる。

> 配達中リアルタイム GPS 案(常時 `watchPosition`)は検討の上で本提案から除外。理由は (1) モバイルブラウザのバックグラウンド GPS 停止で素の Web では実現困難、(2) ドライバー全動線記録による労使協議が長期化、(3) 電池・運用負荷。差別化以上のリスク超過と判断。

**何をするか**
- 各 `ScanEvent` 発生時に 1 回だけ GPS を取得し `ScanEvent.geo` に保存(スナップショット)
- 受取人追跡ページに、過去スキャン地点を地図ピンで時系列表示
- 配車ダッシュボードでハブごとの滞留ヒートマップに活用

**スキーマ追加**: なし(`ScanEvent.geo Json?` は既存 §6 で定義済)

**画面イメージ** → 統合提案資料の §01 を参照: [proposal.html#sec1](proposal.html#sec1)

---

## 12. 段階導入ロードマップ

| フェーズ | 期間目安 | スコープ | 同社へのアウトカム |
|---|---|---|---|
| **PoC** | 1 ヶ月 | 1 営業所(例: 金沢)で集荷〜納品の QR 打刻のみ。`Waybill` `ScanEvent` のみ | 完了報告の電話照会が消える(社内デモ可) |
| **MVP** | +2-3 ヶ月 | 全タッチポイント + 配車ダッシュボード + 公開追跡ページ | **Web追跡なし** という最大の弱点を解消 |
| **α** | +2 ヶ月 | 荷主ポータル(送り状発行・CSV 取込・Webhook) | 大手荷主の DX 要求に応えられる |
| **β** | +3 ヶ月 | 受領サイン・例外管理・KPI ダッシュボード | 早朝便の遅延率・再配達率を可視化 |
| **外販** | 並行 | テナント分離仕上げ + 同業他社向けセットアップ手順 | 同規模の地域路線会社が顧客候補に |

---

## 13. リスクと対応

| リスク | 影響 | 対応 |
|---|---|---|
| `BarcodeDetector` 非対応端末 | 中継所/営業所のタブレットが iPad 中心だと積込局面で動かない | 既存 `/qr` の `html5-qrcode` フォールバックを `/qr-multi` にも組み込む(ループ検出に切替) |
| 早朝便のピーク負荷 | DB 書込スパイク | バッチ POST + `createMany` + 接続プール(`@prisma/adapter-pg`)で吸収。負荷試験を MVP 完了時に実施 |
| 協力会社運用での標準化崩れ | 打刻漏れで追跡が途切れる | ハブごとの「本日未スキャン件数」アラート、配車係に通知 |
| 受領サインの法的扱い | 紛失・破損時の責任所在 | 写真 + サイン + GPS の 3 点保存。電子サインは押印代替の補助とし、紙併用は当面残す |
| マルチテナント漏洩 | 他社情報が見える致命傷 | 全 Route Handler のテストで `tenantId` クロスアクセス試験を必須化 |
| 位置情報の保存期間と個人情報法対応 | コンプライアンス違反 | 90 日経過した詳細座標はハブ粒度に集約し生データ削除。プライバシーポリシーに明記 |

---

## 14. オープン論点(設計確定前に意思決定が必要)

1. **既存資料との整合**:プロジェクト内 [送り状システム設計_全体構造.md](../../送り状システム設計_全体構造.md) との突き合わせ。差分があれば本書を更新
2. **追跡番号の体系**:`OHK-YYYYMMDD-連番` のような可読式 vs ULID/UUID(QR容量・人間可読性のトレードオフ)。現状は可読式を推奨
3. **送り状 1 枚に複数口**(混載):本書では `WaybillItem.pieceCode` で 1QR=1口を採用。荷主オペレーションが「1QR=1送り状」前提なら `WaybillItem` を簡略化
4. **協力会社ドライバーへのアカウント発行**:同社管理 or 協力会社別テナント(独立運用)
5. **受領サインの法的位置付け**:電子サインを正とするか、写真撮影を正とするか
6. **運賃計算・請求**:本書スコープ外だが、`Waybill` の項目設計に影響するため初期合意が必要
7. **既存社内システム(EDI/WMS)との連携**:同社が持つ既存 EDI のフォーマット(独自? 標準?)。CSV/Webhook で十分か API 連携が必要か
8. **位置情報の保存期間・閲覧権限**:何日保持するか・誰が見られるか・受取人にどこまで露出するか

---

## 15. 次のアクション

1. 本書を同社向け提案資料に転記し、§14 の論点を打ち合わせアジェンダに
2. [送り状システム設計_全体構造.md](../../送り状システム設計_全体構造.md) との差分マージ
3. PoC スコープ(1 営業所・タッチポイント①⑥のみ + スキャン時位置)の Prisma schema をブランチ `feat/waybill-poc` で起票
4. 同社へのデモ用に、現在の `/qr-multi` を「金沢営業所積込」モックでラップした画面を試作(本書 §8.1 のワイヤを最小実装)

---

## 16. 決定事項ログ(対話で確定した条件)

設計レビューを通じて確定した方針。**今後の判断はここを正とする**。

### 16.1 顧客・販売モデル
- 想定顧客:**大阪北陸急配 様**(中堅地域路線運送)
- 競合参照モデル:**名鉄こぐまくん / 佐川 e-飛伝 / ヤマト B2 クラウド**(同じ立て付けを目指す)
- 外販はマルチテナント構造で同種の地域路線会社にも展開可能とする

### 16.2 位置情報サービス
- ✅ **採用**:スキャン時 GPS スナップショット(`ScanEvent.geo`)
- ❌ **不採用**:配達中リアルタイム車両追跡(レベル B)
  - 理由:モバイルブラウザのバックグラウンド GPS 停止、ドライバー動線記録の労使懸念、電池・運用負荷
- 表示は **拠点単位** に丸める(プライバシー配慮で実 GPS 座標は受取人画面に出さない)
- 真の位置は ScanEvent に記録、画面表示は拠点マスタの座標を使う

### 16.3 拠点判定方式
- **主:拠点 QR(C)** — 各拠点の入口に拠点 QR を貼り、ドライバーが到着時にスキャンして拠点切替
  - 拠点 QR 形式: `OHK-HUB-<コード>`(例 `OHK-HUB-KANAZAWA`)
  - 送り状 QR 形式: `OHK-YYYYMMDD-NNNNNN`
  - プレフィックスでアプリが自動判定
- **補:ユーザーマスタの所属拠点(A)** — ログイン時のデフォルト
- **裏:GPS 整合性チェック(D)** — 拠点座標とスマホ GPS を照合、大きく離れていたら警告

### 16.4 現場アプリ
- **対象端末**:ドライバーの個人スマホのみ(タブレット不採用、配布も不要)
- **役割**:**検品 + スキャン** を 1 動作で完了
  - 各拠点での出庫時に「予定リストとの突合 → 全件揃ったら出庫送信」
  - 納品時は 1 件ずつスキャンで配達確定
- **規模感**:車両台数 ≒ ドライバー数 ≒ **約 300 アカウント**(自社 153 + 協力会社込み)
- **強み**:抜け・誤積込を出庫前にゼロにできる、紙のチェックリスト不要

### 16.5 荷主ポータル
- **公開モデル**:Web に公開 + ID/パスワード配布のみで運用開始
- ❌ **Webhook / 個別 IT 連携は不要**(将来オプション。荷主側 IT 調整は前提にしない)
- **CSV 取込は標準提供**(中小荷主が大量発行するときの便利機能)
- **規模感**:同社の荷主企業数 ≒ 数十社 × 担当 1〜数名 = **数百アカウント**

### 16.6 管理コンソール
- **送り状管理 と 例外管理 を 1 画面に統合**(クイックフィルタで切替)
- サイドバーから **「車両 / 配車」削除**(`/ops/dashboard` と重複していた)
- サイドバーから **「送り状検索」削除**(送り状管理に統合)
- マスタ画面は ハブ・営業所 / ユーザー の 2 つ

### 16.7 配車ダッシュボード
- 拠点ごとの数字は **「残件数 = 着 - 出発」** に統一(着件数累計ではない)
- ヒートマップは **青基調**、警告のみ赤(色を増やさない)
- 出庫完了拠点(大阪本社・敦賀)は「完了」と表示

### 16.8 規模感の表現方針
- 開発工数(人日)ではなく、**ユーザー数・データ量・ピーク負荷** で表現
- 同社の実数値を反映:自社 153 台 + 協力会社込み 300 台、年商 30 億、早朝便 1,000 件/朝
- 受取人 PV、ドライバー数、荷主数、月間スキャンログ件数 など

### 16.9 UI / 提案資料デザイン方針
- **青ベース統一**(緑・黄・橙は警告のみで使用)
- 装飾を削減:偽スマホステータスバー / LIVE パルス / 絵文字アイコン / グラデーション → 削除
- 専門用語を削減:`Webhook`・`PWA`・`Server Actions`・`Prisma` などの実装用語は提案資料には出さない
- 上段説明文は 15px 以上(読みやすさ優先)
- スマホ・タブレットの「デバイス枠」風装飾は最小限(白い角丸カード)

### 16.10 文書とモックアップ
- 設計ドキュメント:[waybill-system-design.md](waybill-system-design.md)(本書)
- 提出用統合資料:[proposal.html](proposal.html)(1 ファイルで 4 セクション)
- 個別モック群は削除済(統合版に集約)

---

## 17. プロトタイプ実装ログ(2026-05-14 時点)

設計ドキュメントは v0.1(実装着手前)だったが、現場 UX 検証のため Vercel 上に動作する叩き台を用意した。**バックエンド・DB・認証は未実装、すべてフロントエンドのみのデモ**。確定した実装方針と、本番化時に踏み込む論点をここに残す。

### 17.1 ルーティング(リネーム済)

| 旧 | 現行 | 役割 |
|---|---|---|
| `/qr` | **`/delivery`** | 納品検品スキャン(納品先選択→単発スキャン) |
| `/qr-multi` | **`/shipment`** | 出庫検品スキャン(複数 QR 同時) |

旧パスは 404。トップページ([app/page.tsx](../app/page.tsx))の動線も新名称に更新済。リネーム理由は業務名と一致させて荷主・営業所・ドライバー間で誤解を生まないため。

### 17.2 ドライバー UX の原則(プロトタイプで確定)

ドライバーは PC・スマホ操作に習熟していない前提で次を厳守する。

1. **タブは最大 2 つまで**。3 つ以上は認知負荷が高すぎる
2. **カメラを常時画面内に保持**。タブ切替でカメラが隠れる構成は禁止(スキャンしているのに映像が見えないという致命的な混乱を生んだ)
3. **音 + バイブ + フラッシュ** の 3 系統フィードバック。1 系統が環境(マナーモード・騒音)で消えても残り 2 つが効く
4. **取消は 3 秒間だけ可能**。誤スキャンの即時リカバリ用。それを過ぎたら確定として扱う
5. **モーダル / ボタン文言は業務語彙**(「送信」「出庫する」「納品を送信する」)。技術語彙は出さない

### 17.3 `/delivery` の確定設計

#### 画面構成(2 階層)
1. **納品先一覧**(ピッカー)
   - 当日納品先カード(便区分バッジ + 店舗名 + 住所 + 予定個数)
   - 全件完了時は「✓ 本日の納品はすべて完了しました」バナー
   - 納品済カード: 緑背景 + チェックアイコン + 「✓ 納品済」+ 完了時刻
2. **検品画面**(1 画面・タブなし)
   - 上部: ←(納品先へ戻る)+ 店舗名 + 便区分・住所
   - 中部: カメラ(`aspect-[4/3]` の横長)
   - 下部: 進捗バー(緑) + 納品予定リスト(スクロール) + 予定外スキャン履歴

#### スキャン動作
- **単発スキャン**(複数QR同時ではない)。1 フレーム検出で即確定
- **一致** → 緑枠 / 高音ビープ / 振動 80ms / ✓フラッシュ 3 秒 + 取消ボタン
- **予定外** → 赤枠 / 低音ビープ / 振動 [40,60,40]ms / ✕フラッシュ 1.1 秒 / 履歴に追加(1.2 秒クールダウン)
- 取消押下: `seenRef.current.delete(text)` で再スキャン可能に戻す

#### 完了モーダル(全件確定で自動オープン)
- 納品先名 + 件数バナー
- 任意: 納品写真(`<input type="file" accept="image/*" capture="environment">` でネイティブ撮影)
- 任意: メモ(3 行テキストエリア、破損・受領者・特記事項)
- 「納品を送信する」: 件数・写真有無・メモ込みで送信(現状 alert モック) → 該当納品先を完了済に登録 → ピッカーへ復帰
- 「戻る」: モーダル閉じる(再スキャン可能)

### 17.4 `/shipment` の確定設計

#### 画面構成(タブ最大 2)
- **カメラ** タブ / **当日履歴** タブ の 2 つだけ
- かつて「検品結果」タブを置いていたが UX 不良(リスト中もカメラがバックで動き続け映像が見えない)で撤去
- カメラ画面の `LIVE / ✓ N / … M` 浮きバッジ + フラッシュで途中状態が分かるので別タブ不要

#### スキャン動作
- **複数 QR 同時検出**(BarcodeDetector が 1 フレームに含まれる全 QR を返す)
- 確定閾値 `MIN_HITS_TO_CONFIRM = 10`(同じ QR が 10 連続フレームで検出されたら確定)
- 暫定検出は 1.5 秒で失効(`STALE_TENTATIVE_MS`)
- 同じ QR を Map(`candidatesRef`)でキーにして 1 件 1 ステート → **二重カウント発生しない**

#### GPS スナップショット(スキャン開始時に 1 回)
- `navigator.geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 })`
- `maximumAge: 30000` は連続スキャン時の体感速度のため(30 秒以内のキャッシュ再利用)
- `timeout: 8000` は屋内 GPS 弱でいつまでも待たせない上限
- 取得後: **拠点逆引き**(後述)→ カメラ画面下部に種別バッジ + 拠点名表示

#### 送信完了モーダル(モック)
- 送信件数 + 送信時刻 + 担当/車番
- 送信元拠点(種別カラーバッジ + 拠点名 + 住所 + 座標 + Google Maps リンク)
- 送信したコード一覧
- 「閉じる」で次の検品開始可能(状態クリア)

#### 当日履歴タブ
- 上部に「合計 N 件 / M 回送信」+ 拠点別サマリチップ
- 各送信を時刻・拠点・件数のカードで一覧
- タップで展開 → 送信コードと座標詳細
- 履歴はメモリのみ(リロードで消える) → **本番化時は API/DB へ移行必須**

### 17.5 拠点マスタと逆引き(GPS → 拠点名)

スキャン時 GPS スナップショット(§16.2 §11.5)を、**業務語彙の拠点名に変換**するためのマスタを実装。

#### Depot 型
```ts
type DepotKind = "shipper" | "branch" | "relay";
type Depot = {
  id: string;
  name: string;
  kind: DepotKind;
  lat: number;
  lng: number;
  radiusM: number;
  address?: string;
};
```

#### 現在のデモデータ(本番化時は DB 移行 + 実座標差し替え)

| 種別 | id | 拠点 | 住所(参考) | 半径 |
|---|---|---|---|---|
| shipper | toho-amagasaki | 東邦自動車 | 兵庫県尼崎市小中島1-17-15 | 2500m |
| branch | osaka | 大阪営業所 | — | 800m |
| relay | kyoto-relay | 京都中継所 | — | 800m |
| relay | fukui-relay | 福井中継所 | — | 800m |
| branch | kanazawa | 金沢営業所 | — | 800m |

#### 逆引きロジック(精度考慮)
- haversine 距離で全拠点との距離を算出
- 判定式: `distance - accuracyM <= radiusM` (**GPS 誤差円が拠点円と重なれば一致**)
- 屋内/WiFi 測位で精度が ±数百〜数千m に劣化しても拠点を見落とさない
- 複数マッチした場合は最短距離の拠点を採用

#### 採用フロー
```
荷主拠点(shipper) → 大阪営業所(branch) → 中継所(relay) → 金沢営業所(branch) → 納品先
                          スキャン           スキャン            スキャン
                          ↓                ↓                  ↓
                          [拠点ホップ証跡が GPS+QR の二重で記録される]
```

### 17.6 QR コード規則(これから決める)

現状デモは `OHK-XYZ-000121` のような単純連番。実装時には拠点・日付・連番を組み合わせた構造化コードに変更予定。

- 拠点 QR: `OHK-HUB-<コード>`(例 `OHK-HUB-KANAZAWA`) — §16.3 の方式
- 送り状 QR: `OHK-YYYYMMDD-NNNNNN`(例 `OHK-20260514-000123`)
- アプリ側でプレフィックスを見て **拠点QR or 送り状QR を判別**

→ QR 規則は送り状スキーマ設計と一緒に詰める(Phase 2 で確定)。それまではデモ用のフラットコードを使う。

### 17.7 iOS Safari 対応

iOS は `BarcodeDetector API` を未サポート(2026 年現在)。代わりに動的 import で `@sec-ant/barcode-detector/pure` を `window.BarcodeDetector` に登録するポリフィルを噛ませる。

```ts
// app/lib/barcode-detector.ts
export async function ensureBarcodeDetector(): Promise<void> {
  if (typeof window === "undefined") return;
  if (typeof window.BarcodeDetector === "function") return;
  // 初回スキャン時のみロード(WASM)
  const mod = await import("@sec-ant/barcode-detector/pure");
  window.BarcodeDetector = mod.BarcodeDetector as ...;
}
```

- Android Chrome / PC Chrome / Edge: ネイティブ即使用(ポリフィルロードしない)
- iOS Safari / Chrome on iOS: 初回スキャン時に WASM(~1MB)ロード → 以降ネイティブと同じ API
- 同じ呼び出し側コードで両対応可能(`new window.BarcodeDetector({ formats: ["qr_code"] })`)

### 17.8 アクセシビリティ・UX 細部

- 進捗バー: 緑、`transition-all duration-300` でアニメーション
- フラッシュ: OK は 3 秒(取消用に長く)、NG は 1.1 秒
- バイブパターン: 単発 80ms(OK)、3 連振動 [40,60,40]ms(NG)
- 音: 880Hz(OK)、240Hz(NG)、`AudioContext` で動的生成(音源ファイル不要)
- フォント: 数値は `tabular-nums` で桁揃え

### 17.9 デプロイ構成(Vercel)

- **Root Directory: `fullstack-blog-yt`**(必須・モノレポ構成のため)
  - 設定し忘れると Vercel がリポジトリルートを見て 63ms で空デプロイになり全 404 になる(過去発生)
- `package.json` に `"postinstall": "prisma generate"` を入れる(Prisma 7 の generated client は gitignore のため、Vercel ビルド前に生成必須)
- ドメイン: `fullstack-blog-yt-one.vercel.app`(Vercel が自動付与した恒久エイリアス)

---

## 18. 写真アップロード設計(本実装時の必読事項)

`/delivery` の納品写真は現状 `URL.createObjectURL` で blob 表示のみ。**実サーバ送信は未実装**。本番化時は以下が必須。

詳細はメモリ `project_delivery_photo_upload.md` も参照。

### 18.1 正しい構成

```
スマホ → クライアント圧縮(500KB) → S3 直アップ(プリサインドURL)
                                         ↓
                              「保存しました」を Vercel に通知
                                         ↓
                              DB に納品先 / 撮影者 / 時刻 / S3 パスを記録
```

### 18.2 なぜ Vercel に直接送らないか
- **Serverless Function ペイロードは 4.5MB 上限**。スマホ写真 3〜8MB は通らない
- Vercel 帯域(月 1TB 超で課金)を画像で消費するのは経済的に最悪
- S3 直アップ + プリサインド URL(5〜10 分の一時鍵)が定石

### 18.3 圧縮で副次効果
- 長辺 1600px / JPEG 80% で 8MB → **500KB(1/16)**
- `<canvas>` で再描画して `canvas.toBlob(_, "image/jpeg", 0.8)` するだけ
- **EXIF(GPS 位置情報・撮影日時・デバイス情報)が自動的に除去される** → PII リスクが激減

### 18.4 リスク管理
- 個人情報保護法対応(受領者の顔・表札・ナンバープレートの写り込み)
- S3 SSE-S3 / SSE-KMS で at-rest 暗号化
- 保管期間ポリシー(例: 6 ヶ月で S3 ライフサイクル自動削除)
- 端末紛失時のローカルキャッシュ即時削除
- オフライン再送キュー(電波弱い納品先での失敗復旧)

---

## 19. データ連携設計(出庫検品 ↔ 納品検品)

「出庫した内容を納品の予定リストに自動反映するか」の意思決定。

### 19.1 議論した 2 案

| 案 | 内容 | 採否 |
|---|---|---|
| A. 連携(送り状中心) | 荷主が登録した送り状をマスタとし、出庫・納品の両検品がそれを参照 | **採用** |
| B. 独立ツール | 出庫検品と納品検品が完全に別物 | 不採用 |

### 19.2 採用根拠

荷主が事前に送り状データを登録する前提があるため、データ重心は送り状にしか存在し得ない。B を選ぶと**同じデータを二重に持つ**ことになり破綻する。

```
[荷主] 送り状登録(出庫前)
        │
        ▼
   ┌─────────────────────────┐
   │  送り状マスタ DB        │  ← 唯一の真実
   │  ・コード(QR規則)        │
   │  ・納品先                │
   │  ・個数 / 商品           │
   │  ・状態(未/出庫済/納品済) │
   └──────────┬──────────────┘
              │
       ┌──────┴──────┐
       ▼              ▼
   出庫検品         納品検品
  (倉庫で照合)     (現場で照合)
  状態 → 出庫済    状態 → 納品済
```

### 19.3 ロール構成

| ロール | 触る画面 | やること |
|---|---|---|
| 荷主 | 送り状登録 | 出庫前にデータ入力。QR コード発行/印刷 |
| 倉庫員 | 出庫検品 | 当日分の送り状を照合スキャン |
| ドライバー | 納品検品 | 担当便の送り状を納品先ごとにスキャン |
| 管理者 | 進捗ダッシュボード | 全体の出庫済/納品済/未配 を俯瞰 |

### 19.4 段階実装(現実的な踏み方)

```
Phase 1 (今ここ): ハードコードのデモ — 完了
Phase 2: 送り状の最小スキーマ + API
  ・荷主は CSV インポート or 簡易 Web 入力で OK
  ・出庫検品・納品検品はそこを参照するだけに変更
  ・状態フラグ(未/出庫済/納品済)を持つ
Phase 3: 荷主向け画面の本実装
  ・送り状 Web 入力フォーム / QR ラベル PDF 出力 / 履歴閲覧
Phase 4: 整合監視・レポート・通知
  ・「出庫済だが納品されてない」アラート
  ・荷主への自動通知(納品完了 → メール/API)
```

→ Phase 2 から始めるのが効率良い。Phase 1 のまま固定すると後で連携追加時に DB スキーマを作り直す羽目になる。

---

## 20. 未実装 / 宿題

### 20.1 バックエンド(全部未着手)
- Prisma スキーマ(Waybill / Hub / User / ScanEvent / DeliveryProof)
- API ルート群(`/api/waybill`, `/api/scan`, `/api/proof`)
- 認証(NextAuth or Clerk、ロール別)
- マルチテナント対応(`tenantId` のカラム付与)

### 20.2 フロントエンド
- 荷主向け登録画面(まだ存在しない)
- 管理者ダッシュボード(まだ存在しない)
- 履歴の永続化(localStorage → API)
- オフライン対応(IndexedDB キュー、再送ロジック)
- ログイン後のユーザー情報(担当者名・車番)の自動反映 — 現状は山田 / #4 ハードコード

### 20.3 写真アップロード
- S3 バケット作成 + IAM ポリシー
- プリサインド URL 発行 API
- クライアント圧縮実装(canvas resize + EXIF strip)
- 保管期間ライフサイクル設定
- プライバシーポリシーの起草

### 20.4 拠点マスタ
- DEPOTS のハードコードを DB マスタに移行
- 実拠点の正確な座標を取得(現状はおおむね 概算 / 検証用の値)
- 拠点登録 UI(管理者画面)

### 20.5 QR コード規則の確定
- 送り状 QR の桁数・チェックデジット
- 拠点 QR の体系
- 荷主側での印字方法(ラベルプリンタ・PDF・手書きシール)

### 20.6 受託確定後の検討事項
- 大阪北陸急配からの正式受託が前提の機能(現状はモック):
  - 実 S3 設計と本番アップロード
  - 送り状 DB の本格スキーマ
  - 既存基幹システムとの連携 IF
  - ドライバーアカウント発行(300 アカウント想定)
  - 荷主アカウント発行(数百アカウント想定)

---

## 21. 開発時の落とし穴メモ(再現防止)

実装中に踏んだ罠と対応。同じ構成を別案件で扱う時の参考。

### 21.1 Vercel: Unhandled case: [object Object]
- 症状: ダッシュボードで赤いエラー表示。ビルドログ上は 63ms で完了
- 原因: Root Directory がリポジトリルートのままで Next.js が検出されていない
- 対応: Vercel プロジェクト Settings → Build and Deployment → Root Directory を `fullstack-blog-yt` に設定

### 21.2 Vercel: Prisma client not found
- 症状: ビルド中に `@/app/generated/prisma/client` が見つからないエラー
- 原因: Prisma 7 の generated client が gitignore で除外され、`prisma generate` が走っていない
- 対応: `package.json` に `"postinstall": "prisma generate"` を追加

### 21.3 React 19: Cannot call impure function during render
- 症状: `useMemo` 内で `Date.now()` を呼ぶと ESLint エラー(`react-hooks/purity`)
- 原因: React 19 の strict purity ルール
- 対応: `useState(() => Date.now())` でマウント時に固定するか、`useEffect` で `setState` するか、外部から渡す

### 21.4 GPS が屋内で大きくずれる
- 症状: 半径 400m に設定した拠点が ±2000m の精度で外れる
- 原因: 屋内では真の GPS が取れず WiFi 測位に fallback(精度劣化)
- 対応: 拠点半径を 800〜2500m に拡大 + 判定式で `distance - accuracyM <= radiusM` のように **誤差円を考慮**

### 21.5 BarcodeDetector が iOS で動かない
- 症状: スキャン開始時に「未対応」警告が出る
- 原因: iOS Safari / Chrome on iOS が `BarcodeDetector API` 未サポート
- 対応: `@sec-ant/barcode-detector/pure` を動的 import してポリフィル(§17.7)

### 21.6 タブ切替中にカメラがバックグラウンドで動き続ける
- 症状: ドライバーが「検品結果」タブを開いている間も `LIVE` カウンタが増える(でも映像が見えない)
- 原因: タブで隠れた状態でもカメラストリーム・スキャンループは継続している
- 対応: **タブを撤去して 1 画面に統合**(§17.3 §17.4)。カメラを常時画面に保つ

---

## 22. 現場アプリ 実装ハードル・コスト分析

`/delivery` + `/shipment` を実運用に持っていく際の、費用が嵩むポイント・設計が難しいポイント・それぞれの代替案を整理する。**プロトタイプは全部フロント側のモックなので、本番化で発生する追加実装範囲を見積もるための一覧**。

### 22.1 ハードル/コスト マッピング(俯瞰)

凡例: 設計難度 ★1=軽い / ★3=普通 / ★5=重い、費用感は同社規模(ドライバー 300 / 荷主数百 / 月間スキャン 10 万件オーダー)を想定。

| # | 項目 | 設計難度 | 初期費用 | 月額 | 推奨ステータス |
|---|---|---|---|---|---|
| 1 | 写真アップロード(S3 直アップ + 圧縮) | ★★★★ | 中(20-40万) | 月 1-3 万 | Phase 3 以降 |
| 2 | iOS Safari の BarcodeDetector 非対応 | ★★ | 小(数日) | ほぼゼロ | **実装済(ポリフィル)** |
| 3 | オフライン対応(IndexedDB 再送) | ★★★★★ | 大(40-80万) | ゼロ | 必要性次第・Phase 4 |
| 4 | GPS 拠点判定の精度問題 | ★★ | 小 | ゼロ | **実装済(誤差円判定)** |
| 5 | 認証・4 ロール権限 | ★★★ | 中(SaaS) | $25-100/月 | Phase 2 必須 |
| 6 | 拠点マスタ DB + 管理画面 | ★★ | 小-中 | DB 月額に含む | Phase 2 |
| 7 | QR コード規則 + ラベル印字 | ★★ | 中(印字外注) | 印字 1 円/枚 | Phase 2 確定 |
| 8 | プッシュ通知 | ★★★★ | 中 | $0-50/月 | 慎重に検討 |
| 9 | 端末・ブラウザ多様性 | ★★★ | 小 | ゼロ | Phase 2 で限定 |
| 10 | 個人情報保護(写真・GPS) | ★★★ | 中(法務外注) | ゼロ | Phase 3 で着手 |
| 11 | ドライバートレーニング | ★ | 小(動画作成) | ゼロ | 受託後 |
| 12 | 受領サイン / 受領印 | ★★★ | 中 | ゼロ | オプション扱い |
| 13 | 既存基幹システム連携 | ★★★★ | 大(顧客 IT 調整) | ゼロ | §16.5 で不要と決定 |

---

### 22.2 ハイインパクト項目の深掘り

#### 22.2.1 写真アップロード(項目 1)

詳細は §18 参照。本番化の難所:

- **クライアント圧縮の実装**: `<canvas>` で再描画 → `toBlob` で JPEG 化。落とし穴は iOS Safari の Memory limit(大きい画像でクラッシュ)。chunked 処理が必要なケースあり
- **プリサインド URL 発行 API**: AWS SDK を Vercel Function に組み込む。リージョン・有効時間・ACL の調整が要る
- **保管期間ライフサイクル**: S3 ライフサイクルルールで X ヶ月後 Glacier or 削除
- **PII 配慮(個人情報)**: 受領者の顔・表札・ナンバーの写り込みリスク。撮影前の注意ガイド表示 + EXIF GPS 除去で対応

**代替案**:

| 案 | コスト | メリット | デメリット |
|---|---|---|---|
| **A. S3 + プリサインド URL**(推奨) | 月 1-3 万 | スケール強い、業界標準、egress 安い | 実装最重い |
| B. Vercel Blob | 月 5-10 万 | API シンプル、コード 50 行で済む | 大量だと割高 |
| C. Cloudflare R2 | 月 0.5-1.5 万 | **egress 完全無料**(画像取得時の料金ゼロ) | AWS 文化と違うので学習コスト |
| D. 写真撮らない | ゼロ | 実装不要 | 納品証跡が弱くなる(訴訟リスク↑) |
| E. 写真は撮るがローカル保存のみ | ゼロ | 配送会社の責任ゼロ | 機能としての価値ほぼなし |

**推奨**: 初期は C(R2)で軽く始める。スケールしたら A(S3)に移行可能。

#### 22.2.2 オフライン対応(項目 3)

最大の地雷。配送中はトンネル・地下・倉庫内など電波弱い場所が頻発する。スキャンは出来てもサーバ送信が失敗するケースが多発する。

**ハードル**:
- IndexedDB へのキュー保存
- 再送ロジック(指数バックオフ・最大リトライ・サーバ受領確認)
- 重複排除(ネットワーク再送時の同一データ二重送信防止)
- バックグラウンド送信(画面閉じても送る必要があるなら Service Worker)
- コンフリクト解決(オフライン中に状態が変わった場合)

**代替案**:

| 案 | コスト | カバー範囲 |
|---|---|---|
| A. フル実装(Service Worker + Background Sync) | 大(60-80万) | 完全 |
| **B. IndexedDB キュー + 画面復帰時に再送**(推奨) | 中(30-40万) | 90% カバー、ドライバーがアプリを閉じない前提 |
| C. 「電波回復したら再送ボタン」を明示 | 小(10-15万) | ドライバーの操作必要だが分かりやすい |
| D. オフライン対応せず、電波無いと使えない | ゼロ | 倉庫内・市街地のみ運用なら可 |
| E. SMS フォールバック(送信失敗時に SMS で連絡) | 中 | エッジケース処理用 |

**判断**: 同社の業務(早朝便で農協倉庫・北陸の山間地経由)を考えると **C か B が現実的**。A はオーバーキル。

#### 22.2.3 認証・4 ロール権限(項目 5)

ロール: 荷主 / 倉庫員 / ドライバー / 管理者。それぞれ権限が違う。

**ハードル**:
- ロールごとの画面分岐
- 荷主は自社の送り状しか見れない(テナント分離)
- ドライバーは自分が担当する便しか見れない
- 管理者は全部見れる

**代替案**:

| 案 | コスト | メリット |
|---|---|---|
| A. **Clerk**(SaaS) | 月 $25(MAU 10k まで) | UI 全部提供、SSO 連携も簡単、ロール管理あり |
| B. **NextAuth**(無料 OSS) | 開発工数のみ | 自前 DB、自由度高い |
| **C. Auth.js + Prisma adapter**(推奨) | 開発工数のみ | NextAuth の後継、SSR 対応、Prisma と統合 |
| D. 自前 JWT | 開発工数のみ | フル自由、メンテ責任も全部自分 |
| E. クライアント側にロール埋め込み(認証無し) | ゼロ | 検証段階のみ。本番は不可 |

**推奨**: Phase 2 で C(Auth.js + Prisma)。荷主アカウント発行は管理画面から手動で OK。

#### 22.2.4 プッシュ通知(項目 8)

「納品完了したら荷主に通知」「配達遅延を通知」など。実は地雷多い。

**ハードル**:
- iOS Safari の Web Push は iOS 16.4+ かつ ホーム画面追加(PWA)必須
- バックグラウンドプッシュは Service Worker 必要
- ベンダ依存(FCM / OneSignal / 自前)

**代替案**:

| 案 | コスト | カバー範囲 |
|---|---|---|
| A. Web Push(FCM) | 月 $0-50 | Android 強い、iOS は PWA 必須で弱い |
| **B. メール通知**(推奨初期) | 月 $0-30(SendGrid / Resend) | 全端末対応、UX は劣る |
| C. SMS 通知 | 月 30 円/通 | 緊急時のみ。荷主向けは高くつく |
| D. LINE 通知(LINE Notify or Bot) | ゼロ | 同社の荷主は地場企業が多いので LINE 馴染みあるかも |
| E. 通知なし(画面ポーリングのみ) | ゼロ | 機能制限 |

**推奨**: Phase 3 で B(メール)、Phase 4 以降に D(LINE)を検討。Web Push は iOS の壁が高くて投資対効果が悪い。

---

### 22.3 中インパクト項目

#### 22.3.1 QR コード規則 + ラベル印字(項目 7)

§16.3 で方針決定済(`OHK-YYYYMMDD-NNNNNN` 形式)。実運用時の課題:

- **印字方法**: ラベルプリンタ(Brother QL シリーズ ~ 5 万円)/ オフィスプリンタで PDF 印刷
- **シール品質**: 屋外耐性、保管環境(冷蔵・冷凍)耐性
- **チェックデジット**: 手動入力フォームでミス検出するなら必要

**代替案**:
- A. 荷主が自社プリンタで印刷(初期コストゼロ・運用簡単)
- B. 大阪北陸急配 が ラベル発行代行(初期 10-30 万 + 月額)
- C. 既存伝票の QR を流用(検討要・基幹システム次第)

#### 22.3.2 拠点マスタ管理(項目 6)

DEPOTS のハードコードを DB マスタへ。**実装難度は低いが、運用が見落としがち**。

- 全拠点(自社営業所 + 中継所 + 協力会社 + 主要荷主)の正確な座標取得が地味に大変
- 拠点移転・新設・廃止のたびに更新が必要
- 管理画面で CRUD 提供が必要

**代替案**:
- A. **Geocoding API で住所→座標を自動取得**(Google Maps API、月数千円)
- B. 手入力のみ(地図を見て緯度経度をコピペ)
- C. 拠点 QR 方式に全振り(§16.3)→ GPS 座標は補助的にしか使わないので、精度ゆるくて OK

#### 22.3.3 端末・ブラウザ多様性(項目 9)

ドライバー個人スマホは機種・OS が混在。

**実態**:
- Android 7 以上のスマホ: BarcodeDetector ネイティブ対応
- iOS 14 以上: ポリフィル経由で動作
- 古い Android(5/6): BarcodeDetector も WebAssembly もキツい → サポート対象外と割り切る

**代替案**:
- A. **サポート端末を限定**(推奨): 案内文に「Android 7 以上 / iOS 14 以上」を明示
- B. 推奨端末を会社支給(初期 1 万円/台 × 300 = 300 万)
- C. ネイティブアプリ化(Capacitor / React Native)+ ストア配布

#### 22.3.4 受領サイン / 受領印(項目 12)

トラブル時の証跡として重要視するか次第。

**代替案**:
- A. 写真のみ(現状) — 撮影同意 + 受領者顔写し
- B. **指サイン**(react-signature-canvas、実装小・1-2日)— 紙伝票感あって受け入れられやすい
- C. 受領者氏名のテキスト入力 — 簡単だが偽造容易
- D. 電子サインサービス連携(DocuSign 等)— オーバーキル

**推奨**: B を Phase 3 でオプション提供。荷主の希望で ON/OFF できる設定にする。

---

### 22.4 MVP 化のヒント(コスト削減の優先順位)

「最初に実装すべきもの」と「あとから足せるもの」を切り分ける。

#### Phase 2 MVP に含めるもの(必須)
- 認証(項目 5)
- 拠点マスタ(項目 6)
- QR 規則確定(項目 7)
- 既存ロジックの DB 化(履歴・予定・完了状態)

#### Phase 3 で足すもの(差別化要素)
- 写真アップロード(項目 1) → 初期は R2 で軽く
- 受領サイン(項目 12) → 指サインのみ
- 通知(項目 8) → メール のみ

#### Phase 4 以降で検討(運用が落ち着いたら)
- オフライン対応(項目 3) → 必要性が高ければ
- 高度なレポート / 分析
- ネイティブアプリ化

#### あえてやらないもの(削れる場所)
- 配達中 GPS リアルタイム追跡 → §16.2 で不採用
- 基幹システム連携 → §16.5 で不要
- Webhook 連携 → §16.5 で不要
- PWA + Background Sync → 投資対効果が悪い、オフラインは別策で
- iOS ネイティブアプリ → ストア審査が重い、Web で十分

---

### 22.5 概算コストレンジ(プロトタイプ → Phase 2 MVP)

開発工数の目安(同社規模、現場アプリのみ、外注フリーランスレート想定):

| 範囲 | 工数 | 費用(参考) |
|---|---|---|
| Phase 2 MVP(認証 + DB + 既存仕様の本実装) | 60-80 人日 | 360-560 万 |
| Phase 3 拡張(写真 + サイン + メール通知) | 40-50 人日 | 240-350 万 |
| Phase 4 オフライン対応(B 案) | 30-40 人日 | 180-280 万 |

ランニング(月額):
- Vercel: $20-100(Pro プラン)
- DB(Supabase / Neon): $25-100
- 認証(Clerk): $25-200(必要なら)
- ストレージ(R2): $1-50(画像量次第)
- メール(Resend): $0-50
- **合計: 月 1.5-10 万** ※同社規模で

開発総額(現場アプリのみ・MVP〜Phase 3 まで): **600-900 万円** 程度がベースライン。これに荷主ポータル・管理コンソール・基幹連携(やる場合)が乗る。

---

### 22.6 リスク・代替方針サマリ

「金がない・時間がない・人がいない」場合の現実的な落としどころ:

| 切り詰めポイント | 影響 |
|---|---|
| 写真を撮らない | 納品証跡が紙のサインのみになる(現状と同等) |
| オフライン対応を捨てる | 電波の悪い場所では機能しない(撤退選択肢) |
| 通知なし | 荷主は自分でログインして確認する必要 |
| 受領サインなし | 写真のみ |
| 既存基幹システム連携なし | 二重入力が残るが、検品アプリ単体としては動く |
| 拠点マスタ手入力 | 拠点が増減した時に運用が滞る |
| サポート端末限定 | カバー率が下がるが、開発・サポート工数が激減 |

→ **同社向けの最小提案ライン**: 認証 + DB + QR規則 + 拠点マスタ(手入力) + 写真(R2、保管 6ヶ月) + 通知(メールのみ)。これで「ドライバー 300 アカウント、荷主 数百アカウント、月 10 万スキャン」が回る最小構成になる。

---

## 付録 A: 関連ファイル

- 納品検品スキャン(単発): [app/delivery/page.tsx](../app/delivery/page.tsx) / [app/delivery/DeliveryInspection.tsx](../app/delivery/DeliveryInspection.tsx)
- 出庫検品スキャン(複数同時): [app/shipment/page.tsx](../app/shipment/page.tsx) / [app/shipment/ShipmentInspection.tsx](../app/shipment/ShipmentInspection.tsx)
- 共有: [app/lib/barcode-detector.ts](../app/lib/barcode-detector.ts) (型 + iOS Safari 用ポリフィルロード)
- プロジェクト規約: [AGENTS.md](../AGENTS.md)(Next.js 16 / Prisma 7 の運用ルール)
- 本番プロトタイプ: https://fullstack-blog-yt-one.vercel.app/delivery / .../shipment
