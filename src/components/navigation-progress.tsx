"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
import { AdminRouteFallback } from "@/components/admin-route-fallback";
import { CommunityRouteFallback } from "@/components/community-route-fallback";
import {
  clickNavigationHref,
  formNavigationHref,
  navigationIntent,
} from "@/lib/navigation-intent";

type BarState = "idle" | "running" | "done";

type NavigationProgressValue = {
  displayPath: string;
  pendingPath: string | null;
  swapPage: boolean;
  finish: () => void;
};

const NavigationProgressContext = createContext<NavigationProgressValue>({
  displayPath: "/",
  pendingPath: null,
  swapPage: false,
  finish: () => {},
});

export function useNavigationDisplayPath() {
  return useContext(NavigationProgressContext).displayPath;
}

function isAdminPath(pathname: string) {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function NavigationProgressProvider({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const committedUrl = pathname + (search ? "?" + search : "");
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [swapPage, setSwapPage] = useState(false);
  const [bar, setBar] = useState<BarState>("idle");
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const pendingRef = useRef<string | null>(null);
  const committedPath = useRef(pathname);
  const committedSearch = useRef("");
  const finishTimer = useRef<number>(undefined);
  const resetTimer = useRef<number>(undefined);
  const safetyTimer = useRef<number>(undefined);
  const startedAt = useRef(0);

  useEffect(() => {
    const root = document.documentElement;
    const pending = bar === "running" || bar === "done";
    root.toggleAttribute("data-nav-pending", pending);
    root.toggleAttribute("data-nav-swap", pending && swapPage);
    return () => {
      root.removeAttribute("data-nav-pending");
      root.removeAttribute("data-nav-swap");
    };
  }, [bar, swapPage]);

  useEffect(() => {
    if (pendingPath) return;
    committedPath.current = pathname;
    committedSearch.current = search ? "?" + search : "";
  }, [pathname, search, pendingPath]);

  const finish = useCallback(() => {
    if (!pendingRef.current) return;
    pendingRef.current = null;
    window.clearTimeout(safetyTimer.current);
    window.clearTimeout(finishTimer.current);
    // 新页面已经到了就立刻交出去，不让进度条的收尾动画拖住内容。
    setPendingPath(null);
    setSwapPage(false);
    const elapsed = Date.now() - startedAt.current;
    finishTimer.current = window.setTimeout(
      () => {
        setBar("done");
        window.clearTimeout(resetTimer.current);
        resetTimer.current = window.setTimeout(() => setBar("idle"), 320);
      },
      // 极快的切换里进度条只闪一下更难看，给它一个最短可见时长。
      Math.max(0, 160 - elapsed),
    );
  }, []);

  const begin = useCallback((pathname: string, pathChanged: boolean) => {
    window.clearTimeout(finishTimer.current);
    window.clearTimeout(resetTimer.current);
    window.clearTimeout(safetyTimer.current);
    pendingRef.current = pathname;
    startedAt.current = Date.now();
    setPendingPath(pathname);
    setSwapPage(pathChanged);
    setBar("running");
    safetyTimer.current = window.setTimeout(() => finish(), 12_000);
  }, [finish]);

  // 路由真正提交后地址才会变。之前靠 children 引用判断新页面是否到达，
  // 但客户端导航不会重渲染根布局，那个引用永远不变，进度条只能等兜底定时器。
  const committedRef = useRef(committedUrl);
  useEffect(() => {
    if (committedRef.current === committedUrl) return;
    committedRef.current = committedUrl;
    finish();
  }, [committedUrl, finish]);

  const start = useCallback((href: string) => {
    const intent = navigationIntent(href, {
      origin: window.location.origin,
      pathname: committedPath.current,
      search: committedSearch.current,
    });
    if (!intent) return;
    begin(intent.pathname, intent.pathChanged);
  }, [begin]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const href = clickNavigationHref(event);
      if (href) start(href);
    };
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const href = formNavigationHref(form);
      if (href) start(href);
    };
    const onPopState = () => {
      begin(location.pathname, true);
    };
    // 冒泡阶段监听：未保存表单的离开确认在捕获阶段 stopPropagation，
    // 取消导航时这里就不会亮起一个永远不会结束的进度条。
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
      window.removeEventListener("popstate", onPopState);
      window.clearTimeout(finishTimer.current);
      window.clearTimeout(resetTimer.current);
      window.clearTimeout(safetyTimer.current);
    };
  }, [begin, start]);

  return (
    <NavigationProgressContext.Provider
      value={{
        displayPath: pendingPath ?? pathname,
        pendingPath,
        swapPage,
        finish,
      }}
    >
      {mounted
        ? createPortal(
            <div
              className="nav-progress"
              data-state={bar}
              hidden={bar === "idle"}
              role="progressbar"
              aria-hidden={bar === "idle" || undefined}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext="正在加载"
            />,
            document.body,
          )
        : null}
      {children}
    </NavigationProgressContext.Provider>
  );
}

export function NavigationPendingPage({ children }: { children: ReactNode }) {
  const { pendingPath, swapPage, displayPath } = useContext(
    NavigationProgressContext,
  );
  const showFallback = swapPage && pendingPath !== null;

  return (
    <>
      <div hidden={showFallback} aria-hidden={showFallback || undefined}>
        {children}
      </div>
      {showFallback ? (
        isAdminPath(displayPath) ? (
          <AdminRouteFallback pathname={displayPath} />
        ) : (
          <CommunityRouteFallback />
        )
      ) : null}
    </>
  );
}
