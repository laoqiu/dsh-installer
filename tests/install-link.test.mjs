import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInstallLink } from "../lib/protocol.js";

const now = 1800000000;
const source = `https://antistudio.cn/api/catalog/resources/${"a".repeat(32)}/install?version=commit-0123456789ab`;
const link = (changes = {}) =>
  `dsh://install?${new URLSearchParams({ source, nonce: "web-install-nonce", ts: String(now), ...changes })}`;

test("install URLs retain pinned source/version and expire only their clipboard intent", () => {
  assert.deepEqual(parseInstallLink(link(), now), {
    source,
    version: "commit-0123456789ab",
    nonce: "web-install-nonce",
    ts: now,
  });
  assert.equal(
    parseInstallLink(`dsh://install?${new URLSearchParams({ source })}`, now)
      .source,
    source,
  );
  assert.equal(
    parseInstallLink(
      link({
        source: source.replace(
          "https://antistudio.cn",
          "http://127.0.0.1:18082",
        ),
      }),
      now,
    ).version,
    "commit-0123456789ab",
  );
});

test("unrelated text, ambiguous links, credentials, unsupported sources and expired intents are ignored", () => {
  for (const value of [
    "ordinary clipboard text",
    "dsh-installer:v1\ntype: skill",
    "dsh://open",
    link().replace("dsh://install", "dsh://installer"),
    link().replace("dsh://install", "dsh://user@install"),
    link() + "&ts=" + now,
    link() + "&source=" + encodeURIComponent(source),
    link() + "&command=calc.exe",
    link() + "#fragment",
    link({ ts: String(now - 601) }),
    link({ ts: String(now + 61) }),
    link({ ts: "invalid" }),
    link({ nonce: "bad nonce" }),
    link({
      source: source.replace("https://antistudio.cn", "http://evil.test"),
    }),
    link({
      source: source.replace(
        "https://antistudio.cn",
        "https://user:pass@antistudio.cn",
      ),
    }),
    link({ source: source + "&version=other" }),
    link({ source: "https://antistudio.cn/package.zip" }),
  ]) {
    assert.equal(parseInstallLink(value, now), null, value);
  }
});
