export type NavigationIntent = {
  pathname: string;
  search: string;
  pathChanged: boolean;
};

export function navigationIntent(
  href: string,
  current: Pick<URL, "origin" | "pathname" | "search">,
): NavigationIntent | null {
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("javascript:")) {
    return null;
  }
  let next: URL;
  try {
    next = new URL(href, current.origin);
  } catch {
    return null;
  }
  if (next.origin !== current.origin) return null;
  if (next.pathname === current.pathname && next.search === current.search) {
    return null;
  }
  return {
    pathname: next.pathname,
    search: next.search,
    pathChanged: next.pathname !== current.pathname,
  };
}

// 冒泡阶段调用：Next 的 Link 已经在 React 处理器里 preventDefault 了，
// defaultPrevented 对这里没有判别力，取消导航要靠捕获阶段的 stopPropagation。
export function clickNavigationHref(event: MouseEvent): string | null {
  if (event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return null;
  }
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const link = target.closest("a[href]");
  if (!(link instanceof HTMLAnchorElement)) return null;
  if (link.target === "_blank" || link.hasAttribute("download")) return null;
  return link.getAttribute("href");
}

export function formNavigationHref(form: HTMLFormElement): string | null {
  const method = (form.getAttribute("method") || "get").toLowerCase();
  if (method !== "get") return null;
  const action = form.getAttribute("action") || "";
  if (action.startsWith("http") && !action.startsWith(location.origin)) {
    return null;
  }
  const actionUrl = new URL(action || location.pathname, location.origin);
  const query = new URLSearchParams();
  const data = new FormData(form);
  for (const [key, value] of data.entries()) {
    if (typeof value === "string") query.append(key, value);
  }
  actionUrl.search = query.toString();
  return actionUrl.pathname + actionUrl.search;
}
