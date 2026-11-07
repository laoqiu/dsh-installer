import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  access,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { c as createTar, Header } from "tar";
import { gzipSync } from "node:zlib";
import { FreeInstaller } from "../lib/installer.js";
import { safePath, readArchive } from "../lib/archive.js";

const id = "a".repeat(32);
const skill = (name) =>
  `---\nname: ${name}\ndescription: ${name} description\n---\nInstructions\n`;
const defaults = {
  maxArchiveBytes: 1048576,
  maxExpandedBytes: 2097152,
  maxFileBytes: 1048576,
  maxFiles: 100,
  timeoutMs: 5000,
};

function message(origin, changes = {}) {
  const version = changes.version ?? "1.0.0";
  return (
    "dsh://install?" +
    new URLSearchParams({
      source:
        changes.source ??
        `${origin}/api/catalog/resources/${id}/install?version=${version}`,
      nonce: changes.nonce ?? "test-nonce",
      ts: String(changes.ts ?? Math.floor(Date.now() / 1000)),
    })
  );
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "dsh-installer-test-"));
  let archive = Buffer.from(
    zipSync({
      "repo/demo/SKILL.md": strToU8(skill("demo")),
      "repo/demo/scripts/run.mjs": strToU8("example"),
    }),
  );
  const plan = {
    resource_id: id,
    kind: "skill",
    name: "demo",
    version: "1.0.0",
    archive_url: "",
    format: "zip",
    amount_cents: 0,
    repository_url: "https://github.com/org/repo",
    skill_paths: ["demo/SKILL.md"],
    platforms: ["harness"],
  };
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url.startsWith("/api/catalog/resources/")) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ code: 0, data: plan }));
    } else if (request.url === "/redirect") {
      response.writeHead(302, { Location: "http://169.254.169.254/metadata" });
      response.end();
    } else {
      response.end(archive);
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  plan.archive_url = origin + "/archive";
  let calls = [];
  const config = {
    ...defaults,
    origins: [origin],
    downloadHosts: [],
    skillRoot: join(root, "skills"),
    cacheRoot: join(root, "cache"),
  };
  const installer = new FreeInstaller(config, async (path) => {
    calls.push(path);
    return { application: "restart-required" };
  });
  t.after(async () => {
    await installer.close();
    server.close();
    server.closeAllConnections();
    await once(server, "close");
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    origin,
    plan,
    installer,
    requests,
    calls,
    config,
    setArchive(value) {
      archive = value;
    },
  };
}

test("a clipboard install URL resolves a free skill and keeps all assets after confirmation", async (t) => {
  const f = await fixture(t);
  const source = `${f.origin}/api/catalog/resources/${id}/install?version=1.0.0`;
  const text =
    "dsh://install?" +
    new URLSearchParams({
      source,
      nonce: "web-install-nonce",
      ts: String(Math.floor(Date.now() / 1000)),
    });
  const preview = await f.installer.preview(text);
  assert.equal(preview.message.type, "skill");
  assert.equal(preview.message.name, "demo");
  assert.deepEqual(f.requests, [
    `/api/catalog/resources/${id}/install?version=1.0.0`,
  ]);
  const installed = await f.installer.install(preview.ticket);
  assert.equal(installed.kind, "skill");
  assert.equal(
    await readFile(
      join(f.root, "skills", "demo", "scripts", "run.mjs"),
      "utf8",
    ),
    "example",
  );
});

test("a clipboard plugin URL uses the same native install flow and rejects foreign origins", async (t) => {
  const f = await fixture(t);
  Object.assign(f.plan, { kind: "plugin", plugin_types: ["dsh_plugin"] });
  f.setArchive(
    Buffer.from(
      zipSync({
        "repo/package.json": strToU8(
          JSON.stringify({
            name: "demo",
            version: "1.0.0",
            dsh: { bundle: { patch: "./cordis.patch.yml" } },
          }),
        ),
        "repo/cordis.patch.yml": strToU8("[]\n"),
      }),
    ),
  );
  const text =
    "dsh://install?" +
    new URLSearchParams({
      source: `${f.origin}/api/catalog/resources/${id}/install?version=1.0.0`,
    });
  const preview = await f.installer.preview(text);
  assert.equal(preview.message.type, "plugin");
  assert.deepEqual(f.calls, []);
  const result = await f.installer.install(preview.ticket);
  assert.equal(result.kind, "plugin");
  assert.equal(result.restartRequired, true);
  assert.equal(f.calls.length, 1);
  const before = f.requests.length;
  await assert.rejects(
    f.installer.preview(
      "dsh://install?" +
        new URLSearchParams({
          source: `https://untrusted.test/api/catalog/resources/${id}/install?version=1.0.0`,
        }),
    ),
    (error) => error.code === "untrusted-source",
  );
  assert.equal(f.requests.length, before);
});

test("source builds pass a commit-pinned Git target to the native manager after confirmation", async (t) => {
  const f = await fixture(t);
  Object.assign(f.plan, {
    kind: "plugin",
    version: "commit-" + "b".repeat(12),
    plugin_types: ["dsh_plugin"],
    requires_build: true,
    commit_sha: "b".repeat(40),
  });
  f.setArchive(
    Buffer.from(
      zipSync({
        "repo/package.json": strToU8(
          JSON.stringify({
            name: "demo",
            version: "0.0.2",
            main: "lib/index.js",
            scripts: { prepare: "node prepare.mjs" },
            dsh: { bundle: { patch: "./cordis.patch.yml" } },
          }),
        ),
        "repo/cordis.patch.yml": strToU8("[]\n"),
        "repo/prepare.mjs": strToU8(
          "throw new Error('must never be run by the installer test')",
        ),
      }),
    ),
  );
  const preview = await f.installer.preview(
    message(f.origin, {
      version: f.plan.version,
      source: `${f.origin}/api/catalog/resources/${id}/install?version=${f.plan.version}`,
    }),
  );
  assert.deepEqual(f.calls, []);
  const result = await f.installer.install(preview.ticket);
  assert.deepEqual(f.calls, ["github:org/repo#" + "b".repeat(40)]);
  assert.equal(result.restartRequired, true);
});

test("preview does not download; confirmed install preserves skill assets and refuses an existing skill", async (t) => {
  const f = await fixture(t);
  const preview = await f.installer.preview(message(f.origin));
  assert.equal(f.requests.length, 1);
  await assert.rejects(access(f.config.skillRoot));
  const result = await f.installer.install(preview.ticket);
  assert.equal(result.kind, "skill");
  assert.equal(
    await readFile(
      join(f.config.skillRoot, "demo", "scripts", "run.mjs"),
      "utf8",
    ),
    "example",
  );
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.installer.install(preview.ticket), /expired/);
  const repeat = await f.installer.preview(
    message(f.origin, { nonce: "second-nonce" }),
  );
  await assert.rejects(f.installer.install(repeat.ticket), /already-installed/);
  assert.match(
    await readFile(join(f.config.skillRoot, "demo", "SKILL.md"), "utf8"),
    /Instructions/,
  );
});

test("expired confirmation tickets never download or install the resource", async (t) => {
  const f = await fixture(t);
  const preview = await f.installer.preview(message(f.origin));
  t.mock.method(Date, "now", () => (preview.message.ts + 601) * 1000);
  await assert.rejects(f.installer.install(preview.ticket), /expired/);
  assert.equal(f.requests.length, 1);
  assert.equal(f.calls.length, 0);
  await assert.rejects(access(f.config.skillRoot));
});

test("multiple skills reserve destinations together and roll back only newly created directories", async (t) => {
  const f = await fixture(t);
  f.setArchive(
    Buffer.from(
      zipSync({
        "repo/a/SKILL.md": strToU8(skill("first")),
        "repo/b/SKILL.md": strToU8(skill("second")),
      }),
    ),
  );
  f.plan.skill_paths = ["a/SKILL.md", "b/SKILL.md"];
  await mkdir(join(f.config.skillRoot, "second"), { recursive: true });
  await writeFile(join(f.config.skillRoot, "second", "original.txt"), "keep");
  const preview = await f.installer.preview(message(f.origin));
  await assert.rejects(
    f.installer.install(preview.ticket),
    /already-installed/,
  );
  await assert.rejects(access(join(f.config.skillRoot, "first")));
  assert.equal(
    await readFile(join(f.config.skillRoot, "second", "original.txt"), "utf8"),
    "keep",
  );
});

test("paid plans, changed versions, unknown sources and unsupported plugin types never install", async (t) => {
  const f = await fixture(t);
  f.plan.amount_cents = 1;
  await assert.rejects(f.installer.preview(message(f.origin)), /invalid-plan/);
  f.plan.amount_cents = 0;
  f.plan.version = "2.0.0";
  await assert.rejects(f.installer.preview(message(f.origin)), /invalid-plan/);
  f.plan.version = "1.0.0";
  f.plan.kind = "plugin";
  f.plan.plugin_types = ["mcp"];
  await assert.rejects(
    f.installer.preview(message(f.origin)),
    /unsupported-plugin/,
  );
  await assert.rejects(
    f.installer.preview(message("https://untrusted.example")),
    /untrusted-source/,
  );
  assert.equal(f.requests.filter((url) => url === "/archive").length, 0);
});

test("integrity failures and unchecked redirect destinations stop before filesystem installation", async (t) => {
  const f = await fixture(t);
  f.plan.sha256 = "0".repeat(64);
  let preview = await f.installer.preview(message(f.origin));
  await assert.rejects(f.installer.install(preview.ticket), /integrity/);
  delete f.plan.sha256;
  f.plan.archive_url = f.origin + "/redirect";
  preview = await f.installer.preview(message(f.origin));
  await assert.rejects(f.installer.install(preview.ticket), /untrusted-source/);
  await assert.rejects(access(f.config.skillRoot));
});

test("ZIP and TGZ refuse unsafe paths, links and expanded size limits", async (t) => {
  const f = await fixture(t);
  for (const path of [
    "../escape",
    "/absolute",
    "C:/drive",
    "folder\\escape",
    "folder/NUL",
    "file:stream",
  ])
    assert.throws(() => safePath(path), /unsafe-archive/);
  const file = join(f.root, "bad.zip");
  await writeFile(file, zipSync({ "../escape.txt": strToU8("bad") }));
  await assert.rejects(readArchive(file, "zip", defaults));
  await writeFile(file, zipSync({ "big.txt": new Uint8Array(2048) }));
  await assert.rejects(
    readArchive(file, "zip", { ...defaults, maxFileBytes: 1024 }),
    /unsafe-archive|archive-limit/,
  );
});

test("native DSH bundle installation uses a validated persistent archive and preserves restart outcome", async (t) => {
  const f = await fixture(t);
  const source = join(f.root, "package");
  await mkdir(source);
  await writeFile(
    join(source, "package.json"),
    JSON.stringify({
      name: "demo",
      version: "1.0.0",
      dsh: { bundle: { patch: "cordis.patch.yml" } },
    }),
  );
  await writeFile(join(source, "cordis.patch.yml"), "- insert: []\n");
  const tarball = join(f.root, "demo.tgz");
  await createTar({ gzip: true, file: tarball, cwd: f.root }, ["package"]);
  const archive = await readFile(tarball);
  f.setArchive(archive);
  Object.assign(f.plan, {
    kind: "plugin",
    format: "tgz",
    plugin_types: ["dsh_plugin"],
    sha256: createHash("sha256").update(archive).digest("hex"),
  });
  const preview = await f.installer.preview(message(f.origin));
  const result = await f.installer.install(preview.ticket);
  assert.equal(result.restartRequired, true);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(await readFile(f.calls[0]), archive);
});

test("ZIP CRC mismatches are rejected even when the source provides no SHA256", async (t) => {
  const f = await fixture(t);
  const bytes = Buffer.from(
    zipSync({ "example.txt": strToU8("contents") }, { level: 0 }),
  );
  const directory = bytes.indexOf(Buffer.from("504b0102", "hex"));
  assert.ok(directory >= 0);
  bytes.writeUInt32LE(0, directory + 16);
  const file = join(f.root, "bad-crc.zip");
  await writeFile(file, bytes);
  await assert.rejects(readArchive(file, "zip", defaults), /integrity/);
});

test("TGZ symbolic and hard links cannot write outside the chosen resource directory", async (t) => {
  const f = await fixture(t);
  for (const type of ["SymbolicLink", "Link"]) {
    const header = new Header({
      path: "repo/link",
      type,
      linkpath: "../../escape",
      size: 0,
      mode: 0o777,
    });
    header.encode();
    const file = join(f.root, "link.tgz");
    await writeFile(
      file,
      gzipSync(Buffer.concat([header.block, Buffer.alloc(1024)])),
    );
    await assert.rejects(readArchive(file, "tgz", defaults), /unsafe-archive/);
  }
});
