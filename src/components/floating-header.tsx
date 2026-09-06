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

    // 这两个值每帧读一次会强制同步布局；只在尺寸真的变了的时候量。
    let maximum = 0;
    let topBoundary = 0;
    const measure = () => {
      maximum = document.documentElement.scrollHeight - window.innerHeight;
      topBoundary = header.offsetHeight + 24;
    };
    measure();

    const reveal = () => {
      measure();
      state = visibleHeaderAt(Math.max(0, window.scrollY));
      header.dataset.hidden = "false";
    };
    const update = () => {
      frame = 0;
      state = nextHeaderScroll(state, window.scrollY, {
        maximum,
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
    // 图片加载、内容展开都会改变可滚动高度，交给 ResizeObserver 重新量。
    const sizes = new ResizeObserver(measure);
    sizes.observe(document.documentElement);
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
