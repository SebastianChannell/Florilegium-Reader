import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/worker.mjs";

function objectWithBody(range = null) {
  return {
    size: 1000,
    httpEtag: '"example-etag"',
    range,
    writeHttpMetadata(headers) { headers.set("Content-Type", "application/octet-stream"); },
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([37, 80, 68, 70])); controller.close(); } }),
  };
}

const makeEnv = () => ({
  ASSETS: { fetch(request) { return new Response("static:" + new URL(request.url).pathname); } },
  LIBRARY_BUCKET: {
    get(key, options) {
      const range = options.range.get("Range");
      if (range === "bytes=100-103") return objectWithBody({ offset: 100, length: 4 });
      if (range === "bytes=500-") return objectWithBody({ offset: 500 });
      if (range === "bytes=-100") return objectWithBody({ suffix: 100 });
      return objectWithBody(null);
    },
    head(key) { return objectWithBody(null); },
  },
});

test("existing static assets still work", async () => {
  const response = await worker.fetch(new Request("https://reader.example/web/viewer.css"), makeEnv());
  assert.equal(await response.text(), "static:/web/viewer.css");
});

test("cross-domain PDF links redirect to the same-origin viewer file", async () => {
  const upstream = "https://assets.sacrumflorilegium.com/pdfs/viva-el-rey.pdf?v=abc";
  const viewer = `https://reader.example/web/viewer.html?file=${encodeURIComponent(upstream)}`;
  const response = await worker.fetch(new Request(viewer), makeEnv());
  assert.equal(response.status, 302);
  const redirect = new URL(response.headers.get("location"));
  assert.equal(redirect.searchParams.get("file"), "https://reader.example/pdfs/viva-el-rey.pdf?v=abc");
});

test("same-origin PDF streams partial content with byte range headers", async () => {
  const response = await worker.fetch(new Request("https://reader.example/pdfs/viva-el-rey.pdf", {
    headers: { Range: "bytes=100-103" },
  }), makeEnv());
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 100-103/1000");
  assert.equal(response.headers.get("Content-Length"), "4");
  assert.equal(response.headers.get("Content-Type"), "application/pdf");
  assert.equal(response.headers.get("Accept-Ranges"), "bytes");
});

test("HEAD, invalid request method, and unsafe PDF paths", async () => {
  const env = makeEnv();
  const head = await worker.fetch(new Request("https://reader.example/pdfs/viva-el-rey.pdf", { method: "HEAD" }), env);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("Content-Length"), "1000");
  assert.equal((await worker.fetch(new Request("https://reader.example/pdfs/viva-el-rey.pdf", { method: "POST" }), env)).status, 405);
  assert.equal((await worker.fetch(new Request("https://reader.example/pdfs/%2e%2e%2fsecret.pdf"), env)).status, 404);
});

test("open-ended and suffix byte ranges are returned correctly", async () => {
  const env = makeEnv();
  const start = await worker.fetch(new Request("https://reader.example/pdfs/viva-el-rey.pdf", { headers: { Range: "bytes=500-" } }), env);
  assert.equal(start.status, 206);
  assert.equal(start.headers.get("Content-Range"), "bytes 500-999/1000");
  assert.equal(start.headers.get("Content-Length"), "500");
  const suffix = await worker.fetch(new Request("https://reader.example/pdfs/viva-el-rey.pdf", { headers: { Range: "bytes=-100" } }), env);
  assert.equal(suffix.status, 206);
  assert.equal(suffix.headers.get("Content-Range"), "bytes 900-999/1000");
  assert.equal(suffix.headers.get("Content-Length"), "100");
});
