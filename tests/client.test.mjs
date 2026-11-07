import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { setImmediate } from "node:timers/promises";
import { parseInstallLink } from "../lib/protocol.js";
const bundle = await readFile(
  new URL("../lib/client.js", import.meta.url),
  "utf8",
);
const id = "a".repeat(32);
const source = `https://antistudio.cn/api/catalog/resources/${id}/install?version=1.0.0`;
const link = (nonce = "test-nonce") =>
  `dsh://install?${new URLSearchParams({ source, nonce, ts: String(Math.floor(Date.now() / 1000)) })}`;
const preview = (text) => ({
  ticket: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  message: { ...parseInstallLink(text), type: "skill", name: "demo" },
  target: "skills",
  plan: {
    resource_id: id,
    kind: "skill",
    name: "demo",
    version: "1.0.0",
    archive_url: "https://antistudio.cn/archive.zip",
    format: "zip",
    amount_cents: 0,
    repository_url: "",
    platforms: ["harness"],
  },
});
function desktop({
  clipboard = "",
  loopback = true,
  protocol = "dsh-app:",
  generation = true,
  rpc,
} = {}) {
  const calls = [],
    cleanups = [];
  let client,
    actions,
    changed = () => {};
  const window = new EventTarget();
  window.__ModuleLoader__ = {
    load: ({ factory }) => {
      client = factory((name) => {
        if (name === "@deepseek-ai/dsh-client-ui-primitives")
          return { Button: "button", Modal: "dialog" };
        if (name === "react/jsx-runtime")
          return {
            jsx: (type, props) => ({ type, props }),
            jsxs: (type, props) => ({ type, props }),
            Fragment: "fragment",
          };
        throw new Error("Unexpected module " + name);
      });
    },
  };
  runInNewContext(bundle, {
    window,
    URL,
    console,
    location: { protocol },
    navigator: {
      clipboard: {
        readText: async () => clipboard,
        writeText: async (text) => {
          clipboard = text;
        },
      },
    },
    document: {
      visibilityState: "visible",
      hasFocus: () => true,
      addEventListener() {},
      removeEventListener() {},
      createElement: () => ({ remove() {} }),
      head: { appendChild() {} },
    },
  });
  client.apply({
    effect: (fn) => {
      const value = fn();
      if (typeof value === "function") cleanups.push(value);
    },
    locale: { register: () => () => {} },
    slots: {
      inject: (_, fn) => fn(),
      register: (options) => {
        actions = options.inject();
        return () => {};
      },
    },
    connection: {
      isLoopback: loopback,
      generation: {
        getSnapshot: () => (generation ? { id: 1 } : null),
        subscribe: (fn) => {
          changed = fn;
          return () => {};
        },
      },
      rpc: {
        call: async (_, method, payload) => {
          calls.push({ method, payload });
          assert.equal(
            clipboard,
            "",
            "message must already be cleared before Host requests",
          );
          if (rpc) return rpc(method, payload);
          assert.ok(
            !method.includes("protocol-"),
            "normal installation never reads or changes protocol registration",
          );
          return {
            ok: true,
            value: {
              ok: true,
              value: method.endsWith("preview") ? preview(payload.text) : {},
            },
          };
        },
      },
    },
  });
  return {
    actions,
    calls,
    state: () => actions.hooks.installer.getSnapshot(),
    clipboard: () => clipboard,
    setClipboard: (text) => {
      clipboard = text;
    },
    focus: () => window.dispatchEvent(new Event("focus")),
    ready: () => {
      generation = true;
      changed();
    },
    close: () => cleanups.reverse().forEach((fn) => fn()),
  };
}

test("startup and focus consume install URLs before displaying confirmation without protocol registration", async (t) => {
  for (const startup of [true, false]) {
    const app = desktop({ clipboard: startup ? link() : "" });
    t.after(app.close);
    await setImmediate();
    if (!startup) {
      assert.equal(app.state().phase, "idle");
      app.setClipboard(link());
      app.focus();
      await setImmediate();
    }
    assert.equal(app.clipboard(), "");
    assert.equal(app.state().phase, "ready");
    assert.equal(app.calls.length, 1);
    app.actions.dismiss();
    app.focus();
    await setImmediate();
    assert.equal(app.state().phase, "idle");
    assert.equal(
      app.calls.filter((call) => call.method.endsWith("preview")).length,
      1,
      "cancel and refocus do not repeat installation",
    );
    app.setClipboard(link("new-web-click"));
    app.focus();
    await setImmediate();
    assert.equal(app.state().phase, "ready");
    assert.equal(
      app.calls.filter((call) => call.method.endsWith("preview")).length,
      2,
    );
  }
});

test("cold connection waits for the Host; remote or browser sessions never consume local clipboard", async (t) => {
  const local = desktop({ clipboard: link(), generation: false });
  t.after(local.close);
  await setImmediate();
  assert.equal(local.calls.length, 0);
  assert.notEqual(local.clipboard(), "");
  local.ready();
  await setImmediate();
  assert.equal(local.clipboard(), "");
  assert.equal(local.state().phase, "ready");
  for (const options of [{ loopback: false }, { protocol: "https:" }]) {
    const app = desktop({ ...options, clipboard: link() });
    t.after(app.close);
    await setImmediate();
    app.focus();
    await setImmediate();
    assert.equal(app.calls.length, 0);
    assert.notEqual(app.clipboard(), "");
  }
});

test("preview failure has already consumed the link and cannot re-trigger on focus", async (t) => {
  const app = desktop({
    clipboard: link(),
    rpc: async () => ({ ok: true, value: { ok: false, code: "invalid-plan" } }),
  });
  t.after(app.close);
  await setImmediate();
  assert.equal(app.state().phase, "error");
  assert.equal(app.clipboard(), "");
  app.actions.dismiss();
  app.focus();
  await setImmediate();
  assert.equal(app.calls.length, 1);
});

test("archive HTTP failures and Host connection failures remain distinguishable after confirmation", async (t) => {
  for (const transport of [false, true]) {
    const app = desktop({
      clipboard: link(),
      rpc: async (method, payload) =>
        method.endsWith("preview")
          ? { ok: true, value: { ok: true, value: preview(payload.text) } }
          : transport
            ? { ok: false, error: { code: "gateway/connection-lost" } }
            : {
                ok: true,
                value: {
                  ok: false,
                  code: "download-failed",
                  details: { host: "codeload.github.com", status: 403 },
                },
              },
    });
    t.after(app.close);
    await setImmediate();
    assert.equal(app.state().phase, "ready");
    await app.actions.install();
    assert.equal(
      app.state().code,
      transport ? "client-connection" : "download-failed",
    );
    assert.equal(app.clipboard(), "");
    if (!transport) assert.equal(app.state().failure.status, 403);
  }
});
