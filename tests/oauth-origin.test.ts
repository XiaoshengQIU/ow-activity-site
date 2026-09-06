import test from "node:test";
import assert from "node:assert/strict";
import {
  isSameSitePost,
  matchesSiteRequest,
} from "../src/lib/oauth/request-origin";

const site = "https://ow.example.com";
const proxyRequest = (headers: Record<string, string>) => ({
  url: "http://0.0.0.0:3000/api/auth/google/callback",
  headers: new Headers(headers),
});

test("OAuth 接受 HTTPS 代理后的公开域名，同时固定回调目标", () => {
  assert.equal(matchesSiteRequest(proxyRequest({
    host: "ow.example.com", "x-forwarded-proto": "https",
  }), site), true);
  assert.equal(matchesSiteRequest(proxyRequest({
    host: "app:3000", "x-forwarded-host": "ow.example.com", "x-forwarded-proto": "https",
  }), site), true);
  assert.equal(matchesSiteRequest({ url: `${site}/api/auth/github`, headers: new Headers() }, site), true);
  assert.equal(matchesSiteRequest({ url: "http://localhost:3100/api/auth/google", headers: new Headers() }, "http://localhost:3100"), true);
});

test("OAuth 拒绝其他域名、降级协议和有歧义的代理头", () => {
  for (const host of ["evil.example", "ow.example.com,evil.example", "ow.example.com@evil.example", "ow.example.com/path", "ow.example.com\\evil", "ow.example.com:444"]) {
    assert.equal(matchesSiteRequest(proxyRequest({ "x-forwarded-host": host, "x-forwarded-proto": "https" }), site), false);
  }
  for (const protocol of ["http", "https,http", "javascript"]) {
    assert.equal(matchesSiteRequest(proxyRequest({ host: "ow.example.com", "x-forwarded-proto": protocol }), site), false);
  }
});

test("后台更新请求按公开域名校验 Origin，不跟内部部署地址比", () => {
  const browser = {
    url: "https://ow-activity-site-2j8m96nqx-oasis-49e4.vercel.app/api/admin/updates",
    headers: new Headers({
      origin: site,
      host: "ow.example.com",
      "x-forwarded-proto": "https",
    }),
  };
  assert.equal(isSameSitePost(browser, site), true);
  assert.equal(
    isSameSitePost(
      {
        ...browser,
        headers: new Headers({
          origin: "https://ow-activity-site-2j8m96nqx-oasis-49e4.vercel.app",
          host: "ow.example.com",
          "x-forwarded-proto": "https",
        }),
      },
      site,
    ),
    false,
  );
  assert.equal(
    isSameSitePost({ url: `${site}/api/admin/updates`, headers: new Headers() }, site),
    false,
  );
});
