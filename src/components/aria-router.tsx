"use client";

import { RouterProvider } from "react-aria-components";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * React Aria 的链接默认走浏览器原生跳转（RouterContext 的 isNative 默认为 true），
 * HeroUI 组件上的 href 会因此整页刷新。接上 Next 路由后它们才是客户端导航。
 */
export function AriaRouterProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <RouterProvider navigate={(href) => router.push(href)}>
      {children}
    </RouterProvider>
  );
}
