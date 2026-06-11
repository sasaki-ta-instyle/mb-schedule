# mb-schedule

## デプロイ設定（Claude Code 用）

このプロジェクトは ConoHa VPS にデプロイされる。本番反映は「本番にあげて」の指示で起動する（ワークスペース CLAUDE.md の「ConoHa 本番デプロイ」節を参照）。

| キー | 値 |
|---|---|
| CATEGORY | `app` |
| APP_NAME | `mb-schedule` |
| PORT | `3012` |
| 公開URL | `https://app.instyle.group/mb-schedule/` |
| HEALTHCHECK_PATH | `/mb-schedule/api/health` |
| USE_DB | `true` |
| PM2名 | `app-mb-schedule` |
| サーバ側パス | `/var/www/app/mb-schedule/` |
| アプリ固有 env | `/var/www/_shared/apps/app-mb-schedule.env` |

## 共通アセット (favicon / logo / OGP)

`https://app.instyle.group/_shared/static/{favicon.png, logo.svg, ogp.jpg}` で配信。`app/layout.tsx` の metadata に絶対 URL で指定する（詳細: `~/Workspace/docs/conoha-shared-assets.md`）。

```ts
const SITE_URL = "https://app.instyle.group/mb-schedule";
const ASSETS   = "https://app.instyle.group/_shared/static";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  icons: { icon: `${ASSETS}/favicon.png`, apple: `${ASSETS}/favicon.png` },
  openGraph: {
    type: "website", siteName: "INSTYLE GROUP", locale: "ja_JP",
    url: SITE_URL, title: TITLE, description: DESCRIPTION,
    images: [{ url: `${ASSETS}/ogp.jpg`, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image", title: TITLE, description: DESCRIPTION,
    images: [`${ASSETS}/ogp.jpg`],
  },
};
```

## ローカル開発

```bash
pnpm install
pnpm dev
# http://localhost:3000/mb-schedule/ でアクセス（basePath 込み）
```

> **初回コミット前に必ず `pnpm install` を実行**してください。生成された `pnpm-lock.yaml` をコミットに含めないと、GitHub Actions の `actions/setup-node@v4` (`cache: pnpm`) が `Dependencies lock file is not found` で失敗します。

## 本番デプロイ

「本番にあげて」と Claude Code に指示すると、`gh workflow run deploy-prod.yml --ref main` で GitHub Actions が走り、ConoHa VPS にデプロイされる。

手動で起動する場合:
```bash
gh workflow run deploy-prod.yml --ref main
gh run watch
```

## 初回 ConoHa セットアップ手順（このアプリ用）

```bash
# 1. アプリディレクトリ
ssh conoha-deploy 'mkdir -p /var/www/app/mb-schedule/{releases,shared} \
  && touch /var/www/_shared/apps/app-mb-schedule.env \
  && chmod 600 /var/www/_shared/apps/app-mb-schedule.env'

# 2. Nginx location（exact + ^~ prefix の 2 段で trailing-slash 308 ループ回避）
ssh conoha-root 'cat > /etc/nginx/conf.d/proxy-apps/app/mb-schedule.conf <<"EOF"
location = /mb-schedule {
  include snippets/proxy-next.conf;
  proxy_pass http://127.0.0.1:3012;
}
location ^~ /mb-schedule/ {
  include snippets/proxy-next.conf;
  proxy_pass http://127.0.0.1:3012;
}
EOF
nginx -t && systemctl reload nginx'
```

## ロールバック

GitHub Actions 側のヘルスチェック失敗時は自動で前 release に戻る。手動で戻す場合:

```bash
ssh deploy@160.251.201.115
cd /var/www/app/mb-schedule/releases
ls -lt   # 直前の release ディレクトリを確認
ln -sfn <previous-sha> ../current.new && mv -T ../current.new ../current
pm2 reload app-mb-schedule --update-env
```

## デザインシステム

**Liquid design system** を適用。トークンは `app/globals.css`、scene-bg と Gen Interface JP / Gen Interface JP Display のロードは `app/layout.tsx` で行う。詳細は `~/Workspace/design-system_liquid/design.md`。

## 仕様メモ（実装方針）

- **認証あり（書込みのみ）**。GET/HEAD/OPTIONS は無認証で誰でも閲覧可、PUT/POST/PATCH/DELETE は `lib/auth.ts` の cookie セッション必須
  - フロントは「プレビュー / 編集」トグル（localStorage 永続）で edit UI 露出を切替えるが、これは UX 上の見た目だけで、書込みは必ずサーバ側で `middleware.ts` が cookie を検証する
  - cookie 発行は `POST /api/auth/edit-check`（メンバー個別パスワード or `ADMIN_PASSWORD` env で発行）
  - admin パスワードが未設定だとフォールバック値 `1111` で通る（C-2 / 本番では env を必ず設定）
- メンバーは固定 6 名（佐々木 / 田邉 / 山田 / 中野 / 柏木 / 和田）— `db/seed.ts` で投入、追加は seed を編集
- 1 番目（佐々木）が `isAdmin=true`。`AdminMemberPasswordsModal` 等 admin 限定 UI のため最低 1 人は admin が必要
- プロジェクト可視性: `isPrivate=true` のプロジェクトは、未ログイン or `plannedMemberIds` / `visibleMemberIds` に居ない閲覧者から `/api/projects` / `/api/tasks` / `/api/workload` のすべてで隠れる
- 週単位（`weekIso` = `YYYY-Www`, 月曜起算 ISO 8601）
- 工数は 1 人 × 1 週の総工数(h) を `workload` テーブルに 1 件持つ（`numeric(7,2)` まで対応）
- タスクはチェックボックスのみ（`tasks.done`）
- 定例タスク: weekly は毎週、monthly は **「月曜が当月 1〜7 日にある週」のみ**表示（`lib/recurring-virtual.ts`）。月初が金〜日のときは翌週初出になる仕様
- 稼働ルール: 平日のみ / 1 日実働 7.5h / MTG 週 5h 控除 / 通常週 32.5h / 祝日週は自動減算 / 月残業 11h まで（祝日マスタは `lib/holidays-data.ts`、2028 まで投入済み）
- AI タスク生成: `POST /api/ai/generate-tasks` で Claude API を呼ぶ。API キーはサーバ側 `ANTHROPIC_API_KEY` のみ。ユーザー入力は `<user_input>` タグで囲ってプロンプト中の指示と分離
- DB: Neon Postgres (Vercel Marketplace 経由)。Drizzle ORM。`pnpm db:generate` → `pnpm migrate` → `pnpm seed`

## 環境変数

| キー | 用途 | 必須 |
|---|---|---|
| `DATABASE_URL` | Neon Postgres 接続文字列 | ✓ |
| `ADMIN_PASSWORD` | 編集モードの admin パスワード。未設定だと `1111` が通る（本番では必ず設定） | ✓ |
| `ANTHROPIC_API_KEY` | AI タスク生成 | △（AI 機能を使う場合） |

