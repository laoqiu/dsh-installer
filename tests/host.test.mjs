import assert from "node:assert/strict";
import { test } from "node:test";
import { apply } from "../lib/index.js";

test("Host exposes only the installation RPCs and rejects an unknown envelope method", async (t) => {
  const routes = [],
    cleanups = [];
  apply({
    pluginManager: { installBundle: () => assert.fail("must not install") },
    connection: {
      fetch: {
        register: (route) => {
          routes.push(route);
          return () => {};
        },
      },
    },
    effect: (effect) => cleanups.push(effect()),
  });
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
  });
  assert.deepEqual(
    routes.map((route) => route.path),
    [
      "/api/dsh-installer/preview",
      "/api/dsh-installer/install",
      "/api/dsh-installer/discard",
    ],
  );
  const response = await routes[0].fetch(
    new Request("http://localhost/api/dsh-installer/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "client-request",
        rpcId: "test",
        method: "dsh-installer/protocol-register",
        payload: { consent: true },
      }),
    }),
  );
  assert.equal(response.status, 400);
});
