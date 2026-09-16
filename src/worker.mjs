const API_PATH_PATTERN =
  /^\/api\/annotations\/([a-f0-9]{32})\/([a-f0-9]{64})$/u;
const MAX_ANNOTATION_BYTES = 2 * 1024 * 1024;

function jsonResponse(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function annotationObjectKey(vaultId, documentKey) {
  return `_reader-annotations/${vaultId}/${documentKey}.json`;
}

async function hashAuthToken(token) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function timingSafeEqual(left, right) {
  if (typeof left !== "string" || left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function getAuthToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
}

async function authenticate(request, object) {
  const token = getAuthToken(request);
  if (!token || token.length > 256) {
    return false;
  }
  const expected = object?.customMetadata?.authHash;
  if (!expected) {
    return request.method === "PUT";
  }
  return timingSafeEqual(await hashAuthToken(token), expected);
}

function isValidEnvelope(value) {
  return Boolean(
    value?.version === 1 &&
      value.algorithm === "AES-GCM" &&
      typeof value.iv === "string" &&
      value.iv.length >= 16 &&
      value.iv.length <= 32 &&
      typeof value.ciphertext === "string" &&
      value.ciphertext.length > 0 &&
      Number.isFinite(value.updatedAt)
  );
}

async function handleAnnotationRequest(request, env, match) {
  const [, vaultId, documentKey] = match;
  const key = annotationObjectKey(vaultId, documentKey);
  const existing = await env.ANNOTATION_BUCKET.head(key);

  if (request.method === "GET") {
    if (!existing) {
      return jsonResponse({ error: "not_found" }, 404);
    }
    if (!(await authenticate(request, existing))) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }
    const object = await env.ANNOTATION_BUCKET.get(key);
    if (!object) {
      return jsonResponse({ error: "not_found" }, 404);
    }
    return new Response(object.body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        ETag: object.httpEtag,
      },
    });
  }

  if (request.method === "PUT") {
    if (!(await authenticate(request, existing))) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > MAX_ANNOTATION_BYTES) {
      return jsonResponse({ error: "too_large" }, 413);
    }

    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_ANNOTATION_BYTES) {
      return jsonResponse({ error: "too_large" }, 413);
    }

    let envelope;
    try {
      envelope = JSON.parse(body);
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }
    if (!isValidEnvelope(envelope)) {
      return jsonResponse({ error: "invalid_annotation_envelope" }, 400);
    }

    const token = getAuthToken(request);
    const authHash = existing?.customMetadata?.authHash || (await hashAuthToken(token));
    await env.ANNOTATION_BUCKET.put(key, body, {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: {
        authHash,
        updatedAt: String(envelope.updatedAt),
      },
    });
    return jsonResponse({ saved: true, updatedAt: envelope.updatedAt });
  }

  return jsonResponse({ error: "method_not_allowed" }, 405, {
    Allow: "GET, PUT",
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = API_PATH_PATTERN.exec(url.pathname);
    if (match) {
      return handleAnnotationRequest(request, env, match);
    }
    if (url.pathname.startsWith("/api/")) {
      return jsonResponse({ error: "not_found" }, 404);
    }
    return env.ASSETS.fetch(request);
  },
};
