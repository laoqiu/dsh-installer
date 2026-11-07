import assert from "node:assert/strict";
import { test } from "node:test";
import { ClipboardMonitor } from "../lib/clipboard.js";

const message = (nonce) => {
  const link = new URL("dsh://install");
  link.searchParams.set(
    "source",
    `https://antistudio.cn/api/catalog/resources/${"a".repeat(32)}/install?version=1.0.0`,
  );
  link.searchParams.set("nonce", nonce);
  link.searchParams.set("ts", String(Math.floor(Date.now() / 1000)));
  return link.href;
};

test("recognition clears the installation link before preview; focus cannot re-trigger it", async () => {
  let text = "ordinary text",
    prompted = 0,
    writes = 0;
  const monitor = new ClipboardMonitor(
    async () => text,
    async (value) => {
      writes++;
      text = value;
    },
    async () => {
      assert.equal(
        text,
        "",
        "clipboard is consumed before any preview callback",
      );
      prompted++;
    },
  );
  await monitor.check();
  assert.equal(writes, 0);
  text = message("nonce-first");
  await Promise.all([monitor.check(), monitor.check(), monitor.check()]);
  await monitor.check();
  assert.equal(text, "");
  assert.equal(prompted, 1);
  text = message("nonce-second");
  await monitor.check();
  assert.equal(prompted, 2);
  monitor.close();
});

test("a subsequently copied value is neither cleared nor processed as the old installation", async () => {
  let reads = 0;
  const monitor = new ClipboardMonitor(
    async () => (++reads === 1 ? message("nonce-first") : "new user content"),
    async () => assert.fail("must not clear"),
    async () => assert.fail("must not preview"),
  );
  await monitor.check();
  monitor.close();
});

test("unloading during a clipboard read never clears or opens a late dialog", async () => {
  let complete;
  const monitor = new ClipboardMonitor(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    async () => assert.fail("must not clear"),
    async () => assert.fail("must not preview"),
  );
  const pending = monitor.check();
  monitor.close();
  complete(message("nonce-first"));
  await pending;
});

test("a failed clear does not begin installation; the next activation can retry", async () => {
  let text = message("nonce-first"),
    denied = true,
    prompted = 0;
  const monitor = new ClipboardMonitor(
    async () => text,
    async (value) => {
      if (denied) throw new Error("NotAllowedError");
      text = value;
    },
    async () => {
      prompted++;
    },
  );
  await monitor.check();
  assert.equal(prompted, 0);
  denied = false;
  await monitor.check();
  assert.equal(prompted, 1);
  assert.equal(text, "");
  monitor.close();
});
