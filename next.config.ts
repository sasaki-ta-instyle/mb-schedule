import type { NextConfig } from "next";

const APP_NAME = "mb-schedule";

const isVercel = process.env.VERCEL === "1";
const basePath = isVercel ? "" : `/${APP_NAME}`;

const nextConfig: NextConfig = {
  output: "standalone",
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: false,
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  // 旧パスから新しい統合ページへの恒久リダイレクト。
  // basePath は Next.js が自動で前置するため、ここでは basePath なしで書く。
  async redirects() {
    return [
      {
        source: "/tasks",
        destination: "/projects?from=tasks",
        permanent: true,
      },
      {
        source: "/admin",
        destination: "/projects?from=admin",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
