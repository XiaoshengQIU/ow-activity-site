"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { nextHeaderScroll, visibleHeaderAt } from "@/lib/header-scroll";

export function FloatingHeader({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  const headerRef = useRef<HTMLElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    let frame = 0;
    let state = visibleHeaderAt(Math.max(0, window.scrollY));
    header.dataset.hidden = "false";

    // 可滚动高度必须实时读。曾经把它缓存起来靠 ResizeObserver 更新，但页面
    // 变高不一定会通知到 documentElement；一旦缓存值偏小，nextHeaderScroll 里
    // 的钳位会把滚动位置压到 topBoundary 以下，页头就再也不会收起。
    // 页头自身高度变化很少，继续缓存，由它自己的 ResizeObserver 维护。
    let topBoundary = header.offsetHeight + 24;
    const measure = () => {
      topBoundary = header.offsetHeight + 24;
    };

    const reveal = () => {
      measure();
      state = visibleHeaderAt(Math.max(0, window.scrollY));
      header.dataset.hidden = "false";
    };
    const update = () => {
      frame = 0;
      state = nextHeaderScroll(state, window.scrollY, {
        maximum: document.documentElement.scrollHeight - window.innerHeight,
        topBoundary,
        // Dropdown popovers render in a portal; their trigger retains aria-expanded.
        locked: Boolean(
          header.querySelector('[aria-expanded="true"], :focus-visible'),
        ),
      });
      const hidden = String(state.hidden);
      if (header.dataset.hidden !== hidden) header.dataset.hidden = hidden;
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const menus = new MutationObserver(schedule);
    menus.observe(header, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-expanded"],
    });
    const sizes = new ResizeObserver(measure);
    sizes.observe(header);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", reveal);
    window.addEventListener("pageshow", reveal);
    header.addEventListener("focusin", reveal);
    return () => {
      window.cancelAnimationFrame(frame);
      menus.disconnect();
      sizes.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", reveal);
      window.removeEventListener("pageshow", reveal);
      header.removeEventListener("focusin", reveal);
    };
  }, [pathname]);

  return (
    <header ref={headerRef} className={`${className} floating-header`}>
      {children}
    </header>
  );
}
