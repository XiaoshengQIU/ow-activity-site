import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";

function gitValue(args: string[]) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}
const buildCommit =
  process.env.APP_GIT_COMMIT_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  gitValue(["rev-parse", "HEAD"]);

const nextConfig: NextConfig = {
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  serverExternalPackages: [
    "@prisma/adapter-pg",
    "@prisma/client",
    "@vercel/functions",
    "pg",
  ],
  // 固定在构建产物里，不能用远端最新提交冒充当前部署版本。
  env: {
    APP_BUILD_COMMIT: /^[a-f0-9]{40}$/i.test(buildCommit)
      ? buildCommit.toLowerCase()
      : "",
  },
  experimental: {
    serverActions: { bodySizeLimit: "3mb" },
    // 全站都是 force-dynamic，客户端路由缓存默认 0 秒，连后退都要回服务端取。
    staleTimes: { dynamic: 30, static: 180 },
    // lucide-react 在 Next 的默认名单里，HeroUI 不在。
    optimizePackageImports: ["@heroui/react"],
  },
};

export default nextConfig;
