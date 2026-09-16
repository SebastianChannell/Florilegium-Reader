import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/worker.mjs";

class MemoryR2Bucket {
  objects = new Map();

  async head(key) {
    const object = this.objects.get(key);
    return object
      ? { customMetadata: object.customMetadata, httpEtag: '"test"' }
      : null;
  }

  async get(key) {
    const object = this.objects.get(key);
    if (!object) {
      return null;
    }
    return {
      body: object.body,
      customMetadata: object.customMetadata,
      httpEtag: '"test"',
    };
  }

  async put(key, body, options) {
    this.objects.set(key, {
      body,
      customMetadata: options.customMetadata,
    });
  }
}

const vault = "a".repeat(32);
const documentKey = "b".repeat(64);
const url = `https://reader.example/api/annotations/${vault}/${documentKey}`;
const envelope = {
  version: 1,
  algorithm: "AES-GCM",
  iv: "abcdefghijklmnop",
  ciphertext: "encrypted-data",
  updatedAt: 123,
};

test("the annotation API persists and protects encrypted envelopes", async () => {
  const bucket = new MemoryR2Bucket();
  const env = { ANNOTATION_BUCKET: bucket };

  const missing = await worker.fetch(
    new Request(url, { headers: { Authorization: "Bearer secret" } }),
    env
  );
  assert.equal(missing.status, 404);

  const saved = await worker.fetch(
    new Request(url, {
      method: "PUT",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(envelope),
    }),
    env
  );
  assert.equal(saved.status, 200);

  const unauthorized = await worker.fetch(
    new Request(url, { headers: { Authorization: "Bearer wrong" } }),
    env
  );
  assert.equal(unauthorized.status, 401);

  const restored = await worker.fetch(
    new Request(url, { headers: { Authorization: "Bearer secret" } }),
    env
  );
  assert.equal(restored.status, 200);
  assert.deepEqual(await restored.json(), envelope);
});

test("the annotation API rejects invalid documents", async () => {
  const env = { ANNOTATION_BUCKET: new MemoryR2Bucket() };
  const response = await worker.fetch(
    new Request(url, {
      method: "PUT",
      headers: { Authorization: "Bearer secret" },
      body: JSON.stringify({ version: 1, plaintext: "no" }),
    }),
    env
  );
  assert.equal(response.status, 400);
});
