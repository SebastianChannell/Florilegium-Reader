import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptInkDocument,
  deriveSyncCredentials,
  encryptInkDocument,
  getRemoteDocumentKey,
} from "../web/annotation-sync.mjs";

test("annotation documents encrypt and decrypt with a passphrase", async () => {
  const credentials = await deriveSyncCredentials("a durable private phrase");
  const documentKey = await getRemoteDocumentKey("https://example.com/book.pdf");
  const document = {
    version: 1,
    documentId: "https://example.com/book.pdf",
    hidden: false,
    pages: { 4: [{ id: "stroke-1", points: [1, 2, 3, 4] }] },
    updatedAt: 42,
  };

  const envelope = await encryptInkDocument(
    document,
    credentials,
    documentKey
  );
  assert.equal(envelope.algorithm, "AES-GCM");
  assert.equal(JSON.stringify(envelope).includes("stroke-1"), false);
  assert.deepEqual(
    await decryptInkDocument(envelope, credentials, documentKey),
    document
  );
});

test("another passphrase cannot decrypt annotations", async () => {
  const documentKey = await getRemoteDocumentKey("book");
  const first = await deriveSyncCredentials("the correct private phrase");
  const second = await deriveSyncCredentials("a different private phrase");
  const envelope = await encryptInkDocument(
    { version: 1, documentId: "book", hidden: false, pages: {}, updatedAt: 1 },
    first,
    documentKey
  );

  await assert.rejects(decryptInkDocument(envelope, second, documentKey));
});
