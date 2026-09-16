const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const KEY_DERIVATION_SALT = TEXT_ENCODER.encode(
  "Florilegium Reader annotation sync v1"
);
const KEY_DERIVATION_ITERATIONS = 210_000;

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64ToBytes(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function deriveSyncCredentials(passphrase) {
  const normalizedPassphrase = String(passphrase).normalize("NFKC");
  if (normalizedPassphrase.length < 12) {
    throw new Error("Use a passphrase of at least 12 characters.");
  }

  const sourceKey = await crypto.subtle.importKey(
    "raw",
    TEXT_ENCODER.encode(normalizedPassphrase),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: KEY_DERIVATION_SALT,
        iterations: KEY_DERIVATION_ITERATIONS,
      },
      sourceKey,
      512
    )
  );
  const encryptionKey = derived.slice(0, 32);
  const authToken = derived.slice(32);
  const vaultDigest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", authToken)
  );

  return {
    version: 1,
    vaultId: bytesToHex(vaultDigest.slice(0, 16)),
    authToken: bytesToBase64(authToken),
    encryptionKey: bytesToBase64(encryptionKey),
  };
}

export function isValidSyncCredentials(value) {
  return Boolean(
    value?.version === 1 &&
      /^[a-f0-9]{32}$/u.test(value.vaultId) &&
      typeof value.authToken === "string" &&
      value.authToken.length >= 40 &&
      typeof value.encryptionKey === "string" &&
      value.encryptionKey.length >= 40
  );
}

export async function getRemoteDocumentKey(documentId) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", TEXT_ENCODER.encode(documentId))
  );
  return bytesToHex(digest);
}

async function importEncryptionKey(credentials) {
  if (!isValidSyncCredentials(credentials)) {
    throw new Error("Annotation sync credentials are invalid.");
  }
  return crypto.subtle.importKey(
    "raw",
    base64ToBytes(credentials.encryptionKey),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptInkDocument(document, credentials, remoteDocumentKey) {
  const key = await importEncryptionKey(credentials);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = TEXT_ENCODER.encode(
    `${credentials.vaultId}:${remoteDocumentKey}`
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData },
      key,
      TEXT_ENCODER.encode(JSON.stringify(document))
    )
  );

  return {
    version: 1,
    algorithm: "AES-GCM",
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
    updatedAt: document.updatedAt || Date.now(),
  };
}

export async function decryptInkDocument(envelope, credentials, remoteDocumentKey) {
  if (
    envelope?.version !== 1 ||
    envelope.algorithm !== "AES-GCM" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) {
    throw new Error("The saved annotation data has an unsupported format.");
  }

  const key = await importEncryptionKey(credentials);
  const additionalData = TEXT_ENCODER.encode(
    `${credentials.vaultId}:${remoteDocumentKey}`
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(envelope.iv),
      additionalData,
    },
    key,
    base64ToBytes(envelope.ciphertext)
  );
  return JSON.parse(TEXT_DECODER.decode(plaintext));
}
