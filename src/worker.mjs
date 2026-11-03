const ASSETS_ORIGIN = "https://assets.sacrumflorilegium.com";

function pdfKey(pathname) {
  try {
    const key = decodeURIComponent(pathname.slice(1));
    return /^pdfs\/[^/\\]+\.pdf$/i.test(key) && !key.includes("..") ? key : null;
  } catch {
    return null;
  }
}

function redirectAssetToReader(url) {
  const file = url.searchParams.get("file");
  if (!file) return null;

  let source;
  try {
    source = new URL(file);
  } catch {
    return null;
  }
  if (source.origin !== ASSETS_ORIGIN || !pdfKey(source.pathname)) return null;

  const replacement = new URL(source.pathname + source.search, url.origin);
  const redirect = new URL(url);
  redirect.searchParams.set("file", replacement.href);
  return new Response(null, {
    status: 302,
    headers: {
      Location: redirect.href,
      "Cache-Control": "no-store",
    },
  });
}

async function servePdf(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const key = pdfKey(url.pathname);
  if (!key) return new Response("Not Found", { status: 404 });

  const object = request.method === "HEAD"
    ? await env.LIBRARY_BUCKET.head(key)
    : await env.LIBRARY_BUCKET.get(key, { range: request.headers });
  if (!object) return new Response("Not Found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", "application/pdf");
  headers.set("Content-Disposition", "inline");
  headers.set("Accept-Ranges", "bytes");
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=300");
  headers.set("X-Content-Type-Options", "nosniff");

  if (request.method === "HEAD") {
    headers.set("Content-Length", String(object.size));
    return new Response(null, { status: 200, headers });
  }

  if (!("body" in object)) return new Response(null, { status: 412, headers });

  let status = 200;
  if (request.headers.has("Range") && object.range) {
    const { offset, length, suffix } = object.range;
    const start = Number.isInteger(suffix)
      ? Math.max(0, object.size - suffix)
      : (offset ?? 0);
    const bytes = Number.isInteger(suffix)
      ? Math.min(suffix, object.size)
      : Math.min(length ?? (object.size - start), object.size - start);
    if (Number.isInteger(start) && Number.isInteger(bytes) && bytes > 0 && start >= 0) {
      headers.set("Content-Range", `bytes ${start}-${start + bytes - 1}/${object.size}`);
      headers.set("Content-Length", String(bytes));
      status = 206;
    }
  }
  if (status === 200) headers.set("Content-Length", String(object.size));
  return new Response(object.body, { status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/pdfs/")) {
      return servePdf(request, env, url);
    }
    if ((url.pathname === "/web/viewer.html" || url.pathname === "/web/viewer") &&
        (request.method === "GET" || request.method === "HEAD")) {
      const redirect = redirectAssetToReader(url);
      if (redirect) return redirect;
    }
    return env.ASSETS.fetch(request);
  },
};
