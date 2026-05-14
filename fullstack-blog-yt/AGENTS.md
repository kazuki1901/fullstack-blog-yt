<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# fullstack-blog-yt

Next.js 16 (App Router) + Prisma 7 + PostgreSQL のフルスタックブログ学習プロジェクト。

> 上のブロックの通り、**Next.js 16 / React 19 / Prisma 7 は学習データより新しい可能性が高い**。API・規約・ファイル構成が古い知識と異なる場合があるため、コードを書く前に `node_modules/next/dist/docs/` および公式ドキュメントを参照すること。

## 技術スタック

| 種別 | 採用 | バージョン | 備考 |
|---|---|---|---|
| Framework | Next.js | 16.2.4 | App Router 前提 |
| UI | React | 19.2.4 | Server Components 中心 |
| ORM | Prisma | 7.8.0 | generator は `prisma-client`(新)、`prisma-client-js` ではない |
| DB Driver | `@prisma/adapter-pg` + `pg` | 7.8.0 / 8.20.0 | Prisma 7 は driver adapter 必須 |
| DB | PostgreSQL | - | 接続文字列は `DATABASE_URL` |
| Style | TailwindCSS | v4 | `@tailwindcss/postcss` 経由 |
| Lint | ESLint | v9 + `eslint-config-next` | `npm run lint` |
| Lang | TypeScript | 5.x | strict 推奨 |
| Deploy | Vercel | - | `vercel.json` あり |
| その他 | `html5-qrcode` | 2.3.8 | `/qr` で QR読み取り |

## ディレクトリ構成

```
fullstack-blog-yt/
├─ app/                       # App Router
│  ├─ layout.tsx              # ルートレイアウト
│  ├─ page.tsx                # トップ(投稿一覧)
│  ├─ blog/
│  │  ├─ add/page.tsx         # 新規作成
│  │  └─ edit/[id]/page.tsx   # 編集
│  ├─ qr/
│  │  ├─ page.tsx             # QR読み取りページ
│  │  └─ QrScanner.tsx        # クライアントコンポーネント
│  ├─ sample/page.tsx         # サンプル
│  ├─ api/blog/
│  │  ├─ route.ts             # GET 一覧 / POST 作成
│  │  └─ [id]/route.ts        # 単体 CRUD
│  ├─ lib/
│  │  └─ prisma.ts            # Prisma singleton(必ずこれ経由で import)
│  └─ generated/prisma/       # Prisma が生成(gitignore 済、コミット禁止)
├─ prisma/
│  └─ schema.prisma           # スキーマ定義
├─ next.config.ts
├─ tsconfig.json
├─ vercel.json
└─ .env                       # DATABASE_URL を記述(コミット禁止)
```

## 環境構築(初回)

1. `npm install`
2. `.env` を作成し `DATABASE_URL="postgresql://..."` を設定
3. `npx prisma generate` で [app/generated/prisma/](app/generated/prisma/) を生成(必須・clone 直後は存在しない)
4. スキーマ未反映なら `npx prisma migrate dev`
5. `npm run dev` で http://localhost:3000

## よく使うコマンド

```powershell
npm run dev          # 開発サーバー起動
npm run dev:clean    # .next を消してから起動(キャッシュ起因の不具合時)
npm run build        # 本番ビルド(デプロイ前確認)
npm run lint         # ESLint
npx prisma studio    # GUI で DB を覗く(デバッグに便利)
npx prisma generate  # schema.prisma 変更後の型再生成
npx prisma migrate dev --name <name>  # マイグレーション作成+適用
```

## Prisma 7 運用(重要)

- **generator は `prisma-client`**(末尾 `-js` なし)。出力先は `../app/generated/prisma` で固定。
- **Driver adapter 必須**。`PrismaClient` を直接 `new` せず、必ず [app/lib/prisma.ts](app/lib/prisma.ts) の singleton(`@/app/lib/prisma`)を使う。HMR で接続が増えるのを防ぐためグローバルキャッシュを噛ませている。
- **import 元は `@/app/generated/prisma/client`**。`@prisma/client` ではない。
- スキーマ変更フロー:
  1. `prisma/schema.prisma` を編集
  2. `npx prisma migrate dev --name <変更内容>`(開発DB用)
  3. 本番は `npx prisma migrate deploy`
- [app/generated/prisma/](app/generated/prisma/) は gitignore 済。clone 後は `prisma generate` を必ず実行。

## API ルート規約

- App Router の Route Handler([app/api/**/route.ts](app/api/blog/route.ts))を使用。
- レスポンスは `NextResponse.json(body, { status })`。
- エラーは `console.error` + 500 を返す。**詳細メッセージをクライアントに漏らさない**。
- 現状 `finally { await prisma.$disconnect() }` を入れているが、**サーバーレス/HMR では singleton と相性が悪い**。新規ハンドラでは `$disconnect` を入れない方針(既存も順次外す)。

## 命名・配置の規約

- ページ: `app/<route>/page.tsx`(Server Component デフォルト)
- クライアント側専用コンポーネントは `'use client'` を付け、ページ直下に同居(例: [app/qr/QrScanner.tsx](app/qr/QrScanner.tsx))
- DB アクセスは Server Component または Route Handler 内のみ。Client Component から直接呼ばない。
- 共有ユーティリティは [app/lib/](app/lib/) 配下。
- スタイルは Tailwind ユーティリティ優先、CSS Modules は最小限。

## デバッグ動線

- ブラウザ確認は Playwright MCP が利用可能(`mcp__playwright__browser_navigate` 等)。`/open-app` スラッシュコマンドで `localhost:3000` を開ける。
- DB 状態は `npx prisma studio` が一番速い。
- 500 エラーが出たら、まずサーバーコンソール(`npm run dev` を起動しているターミナル)のスタックトレースを確認する。
- `.next` キャッシュ起因の謎挙動が出たら `npm run dev:clean`。

## ブランチ・コミット運用

- メインブランチ: `main`
- 新機能・修正は `feat/<topic>` または `fix/<topic>` ブランチを切る(main 直 push は避ける)
- コミットメッセージは日本語可。Conventional Commits 風(`feat:`, `fix:`, `chore:`, `refactor:` など)を推奨。
- PR レビューは `/review` または `/security-review` スラッシュコマンドを利用。

## 機密情報の扱い

- `.env`, `.env.*` は **絶対にコミットしない**(`.gitignore` 済)。
- `DATABASE_URL` 等の秘密値は Vercel の環境変数または `.env.local` で管理。
- API レスポンスにスタックトレース・SQL・接続情報を含めない。

## デプロイ

- Vercel 連携(`vercel.json` で `framework: nextjs` を明示)
- main への push で本番デプロイ(運用が固まったら preview ブランチ運用に変更)
- 本番マイグレーションは `npx prisma migrate deploy` を CI/手動で実行(`migrate dev` は本番禁止)
