// Reverse proxies may leave NextRequest.url pointing at the container hostname.
// Forwarded headers are only compared with the configured origin; they never
// choose a redirect destination or broaden the set of accepted sites.
export function matchesSiteRequest(
  request: Pick<Request, "headers" | "url">,
  configuredOrigin: string,
) {
  try {
    const internal = new URL(request.url);
    const host =
      request.headers.get("x-forwarded-host") ??
      request.headers.get("host") ??
      internal.host;
    const protocol =
      request.headers.get("x-forwarded-proto") ??
      internal.protocol.slice(0, -1);
    if (!/^[^\s/\\?#@,]+$/.test(host)) return false;
    if (protocol !== "https" && protocol !== "http") return false;
    return new URL(`${protocol}://${host}`).origin === configuredOrigin;
  } catch {
    return false;
  }
}
export function isSameSitePost(
  request: Pick<Request, "headers" | "url">,
  configuredOrigin: string,
) {
  return (
    request.headers.get("origin") === configuredOrigin &&
    matchesSiteRequest(request, configuredOrigin)
  );
}
