import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { SWRProvider } from "@/lib/swr-config";

// 本番 (ConoHa) は basePath 込みの絶対 URL。Vercel preview では basePath を使わないので、
// その場合は VERCEL_URL から base を組み立て、OGP / 相対リンクの解決を Vercel ドメイン基準にする (N-3)。
const PROD_SITE_URL = "https://app.instyle.group/mb-schedule";
const SITE_URL =
  process.env.VERCEL === "1" && process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : PROD_SITE_URL;
const ASSETS = "https://app.instyle.group/_shared/static";
const TITLE = "プロジェクト週次ダッシュボード (Mebius) | INSTYLE GROUP";
const DESCRIPTION = "メビウス製薬の週単位プロジェクト・タスク・工数を管理するチームボード";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  icons: {
    icon: `${ASSETS}/favicon.png`,
    apple: `${ASSETS}/favicon.png`,
  },
  openGraph: {
    type: "website",
    siteName: "INSTYLE GROUP",
    locale: "ja_JP",
    // OGP では本番の最終 URL を載せたいので、Vercel preview でも本番 URL を出す。
    url: PROD_SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: `${ASSETS}/ogp.jpg`, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [`${ASSETS}/ogp.jpg`],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/gen-interface-jp@0.5.0/all.css"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="scene-bg" aria-hidden="true" />
        <SWRProvider>
          <AppShell>{children}</AppShell>
        </SWRProvider>
      </body>
    </html>
  );
}
