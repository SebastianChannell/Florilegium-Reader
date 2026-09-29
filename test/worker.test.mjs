import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/worker.mjs";

test("the worker delegates requests to static assets", async () => {
  const request = new Request("https://reader.example/web/viewer.html");
  let receivedRequest = null;

  const expected = new Response("viewer", {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });

  const env = {
    ASSETS: {
      fetch(incoming) {
        receivedRequest = incoming;
        return expected;
      },
    },
  };

  const response = await worker.fetch(request, env);

  assert.equal(receivedRequest, request);
  assert.equal(response, expected);
});
