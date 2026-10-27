// Cloudflare Worker — resilient, shared-cache CORS front-end for the NHL web API.
// Any path is forwarded to api-web.nhle.com, e.g.
//   https://<worker>.workers.dev/v1/standings/now  ->  https://api-web.nhle.com/v1/standings/now
// The root path / returns a health ping so "is the worker alive?" is testable
// without relying on the NHL upstream.
//
// TWO cache layers, both sharing one copy of the data:
//   1) Cloudflare's EDGE cache — driven by the Cache-Control we emit on the
//      response (s-maxage / stale-while-revalidate). Every visitor at a data
//      centre gets the SAME cached copy; the NHL upstream is only contacted when
//      that copy goes stale. This is what turns "one request per visitor" into
//      "a handful per hour", which is what removes the 429s.
//   2) The worker's own Cache API — a persistent fallback so that when the NHL
//      upstream returns 429/5xx or the network drops, the worker serves the last
//      good copy as a plain 200. The dashboard never blanks.
// Background revalidation runs OFF the response path so a cache hit is instant
// and a 429 can never stall a visitor.
const UPSTREAM = "https://api-web.nhle.com";
const CACHE_NAME = "nhl-web-v1";

// ── Caching tunables ──────────────────────────────────────────────────────────
// Games run ~once/day and standings drift slowly, so a long edge lifetime is
// safe. EDGE_MAX_AGE = how long Cloudflare serves one copy to all visitors;
// EDGE_STALE keeps serving it that much longer while a single background
// revalidation refreshes the edge. Bump these higher to reduce upstream calls
// even further; lower them if a live game must reflect fast.
const EDGE_MAX_AGE  = 30 * 60; // 30 min: how long the edge holds the copy
const EDGE_STALE    = 30 * 60; // +30 min: keep serving it while refreshing
const BROWSER_MAX_AGE = 10 * 60; // a visitor's browser stays fresh 10 min

// Public read proxy: reflect "*" so any reader (the live site + local dev) works.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Max-Age": "86400",
};

function diag(h, serving, upStatus, upMs, upErr, upSource) {
  const out = new Headers(h);
  if (upSource != null) out.set("x-upstream-source", upSource);
  if (upStatus != null) out.set("x-upstream-status", String(upStatus));
  if (upMs     != null) out.set("x-upstream-ms",     String(upMs));
  if (upErr    != null) out.set("x-upstream-err",    upErr);
  if (serving  != null) out.set("x-serving",         serving);
  return out;
}

// Fire-and-forget refresh of the worker's own cache. Never blocks a response and
// never throws; on 429/5xx it simply leaves the last good copy in place so the
// next request still gets a 200.
async function refresh(key, originUrl, cacheObj) {
  let upMs = null, upStatus = 0, upErr = null;
  const t0 = Date.now();
  try {
    const live = await fetch(originUrl, { redirect: "follow" });
    upMs = Date.now() - t0;
    upStatus = live.status;
    if (live.status < 400) {
      const text = await live.text();
      await cacheObj.put(key, new Response(text, { status: 200, headers: { "x-nhl-fetched": String(upMs) } }));
    }
    // 4xx/5xx: leave the existing cached copy intact (stale fallback).
  } catch (e) {
    upMs = Date.now() - t0;
    upErr = e && e.message;
  }
}

export default {
  async fetch(request) {
    try {
      if (request.method === "OPTIONS") return new Response(null, { headers: cors });
      const url = new URL(request.url);
      const path = url.pathname + url.search;

      // Health ping: the worker is up even if the NHL upstream is not.
      if (path === "/" || path === "") {
        return new Response(
          JSON.stringify({
            ok: true,
            service: "nhl-cors-proxy",
            upstream: UPSTREAM,
            edgeMaxAgeMin: EDGE_MAX_AGE / 60,
            edgeStaleMin: EDGE_STALE / 60,
            browserMaxAgeMin: BROWSER_MAX_AGE / 60,
          }),
          diag({ ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
            "health", "ok", 0, null, null)
        );
      }

      const originUrl = UPSTREAM + path;
      const key = new Request(originUrl, { method: "GET" });
      const cacheObj = await caches.open(CACHE_NAME);
      const cached = await cacheObj.match(key); // any status; may be a stale 4xx

      // ── Fast path: serve the last good copy instantly, refresh behind it ──
      if (cached && cached.status < 400) {
        const body = await cached.text();
        const headers = diag(
          { ...cors, "Content-Type": cached.headers.get("Content-Type") || "application/json" },
          "cache", null, null, null, originUrl
        );
        // Shared by all visitors: the Cloudflare edge honours this and serves the
        // same body to everyone, contacting the upstream only when it goes stale.
        headers.set("Cache-Control",
          `public, s-maxage=${EDGE_MAX_AGE}, stale-while-revalidate=${EDGE_STALE}, max-age=${BROWSER_MAX_AGE}`);
        // Keep the copy fresh for the next time, off the response critical path.
        refresh(key, originUrl, cacheObj);
        return new Response(body, { status: 200, headers });
      }

      // ── Cold path: no usable copy yet, so we must wait for the upstream ──
      const t0 = Date.now();
      let live = null, upStatus = 0, upMs = null, upErr = null, serving, source;
      try {
        live = await fetch(originUrl, { redirect: "follow" });
        upMs = Date.now() - t0;
        upStatus = live.status;
      } catch (e) {
        upMs = Date.now() - t0;
        upErr = e && e.message;
      }

      if (live && live.status < 400) {
        source = live;
        serving = "fresh";
      } else if (live) {
        // Cold + upstream erroring (e.g. very first request during a 429): pass the
        // real status through, but tell the edge NOT to cache a 4xx/5xx.
        source = live;
        serving = "passthrough-" + live.status;
      } else {
        // Truly nothing: no upstream and no cache.
        return new Response(
          JSON.stringify({ error: "NHL API unavailable: " + upErr }),
          diag({ ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
            "error", 0, upMs, upErr, originUrl)
        );
      }

      const body = await source.text();
      const headers = diag(
        { ...cors, "Content-Type": source.headers.get("Content-Type") || "application/json" },
        serving, upStatus, upMs, upErr, originUrl
      );

      if (serving === "fresh") {
        // Stash it so future requests (and 429s) serve it, and let the edge hold it.
        try {
          await cacheObj.put(key, new Response(body, { status: 200, headers: { "x-nhl-fetched": String(upMs) } }));
        } catch (_) {}
        headers.set("Cache-Control",
          `public, s-maxage=${EDGE_MAX_AGE}, stale-while-revalidate=${EDGE_STALE}, max-age=${BROWSER_MAX_AGE}`);
      } else {
        // Passthrough 4xx/5xx on a cold cache: don't make the edge cache the error.
        headers.set("Cache-Control", "no-store");
      }

      return new Response(body, { status: serving === "fresh" ? 200 : source.status, headers });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "worker: " + (err && err.message) }),
        diag({ ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
          "worker-error", 0, null, (err && err.message) || "unknown", null)
      );
    }
  },
};
