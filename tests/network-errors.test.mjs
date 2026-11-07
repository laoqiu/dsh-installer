import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { fetchBytes } from "../lib/network.js";

test("archive downloads negotiate any binary type while plans request JSON", async (t) => {
  const accepts = [];
  const server = createServer((req, res) => {
    accepts.push(req.headers.accept);
    if (req.url === "/archive" && req.headers.accept !== "*/*") {
      res.writeHead(415).end();
      return;
    }
    res.end(req.url === "/archive" ? "archive bytes" : "{}");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  const origin = "http://127.0.0.1:" + server.address().port;
  const policy = {
    origins: [origin],
    downloadHosts: [],
    timeoutMs: 2000,
    maxArchiveBytes: 1024,
  };
  assert.equal(
    (
      await fetchBytes(
        origin + "/archive",
        policy,
        AbortSignal.timeout(3000),
        true,
      )
    ).toString(),
    "archive bytes",
  );
  await fetchBytes(origin + "/plan", policy, AbortSignal.timeout(3000), false);
  assert.deepEqual(accepts, ["*/*", "application/json"]);
});

test("HTTP errors identify the failed stage and host without returning signed URL parameters", async (t) => {
  const server = createServer((req, res) => {
    res.writeHead(req.url.startsWith("/plan") ? 404 : 403);
    res.end("upstream details are not passed to the client");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  const origin = "http://127.0.0.1:" + server.address().port;
  const policy = {
    origins: [origin],
    downloadHosts: [],
    timeoutMs: 2000,
    maxArchiveBytes: 1024,
  };
  for (const [archive, path, code, status] of [
    [false, "plan", "plan-failed", 404],
    [true, "archive", "download-failed", 403],
  ]) {
    await assert.rejects(
      fetchBytes(
        origin + "/" + path + "?token=not-for-display",
        policy,
        AbortSignal.timeout(3000),
        archive,
      ),
      (error) => {
        assert.equal(error.code, code);
        assert.equal(error.details.host, "127.0.0.1");
        assert.equal(error.details.status, status);
        assert.ok(!JSON.stringify(error.details).includes("token"));
        return true;
      },
    );
  }
});
