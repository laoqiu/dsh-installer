/** Free archive installer. A2M, device identities and purchase receipts belong to anticli. */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";
import {
  readArchive,
  safePath,
  type ArchiveFile,
  type ArchiveLimits,
} from "./archive.js";
import { InstallError } from "./errors.js";
import { fetchBytes, type NetworkPolicy } from "./network.js";
import {
  parseInstallLink,
  MESSAGE_TTL_SECONDS,
  Message,
  Plan,
  type InstallPreview,
} from "./protocol.js";

export interface InstallerConfig extends NetworkPolicy, ArchiveLimits {
  skillRoot: string;
  cacheRoot: string;
}
export interface BundleResult {
  application: string;
  error?: { code: string };
  restartReason?: string;
}
export interface Installed {
  kind: "skill" | "plugin";
  paths: string[];
  restartRequired: boolean;
}

function digestMatches(
  data: Buffer,
  algorithm: string,
  expected: string,
  encoding: BufferEncoding,
): boolean {
  const actual = createHash(algorithm).update(data).digest(),
    wanted = Buffer.from(expected, encoding);
  return wanted.length === actual.length && timingSafeEqual(wanted, actual);
}

/** Own previews and one serial filesystem/package operation for the plugin lifetime. */
export class FreeInstaller {
  private readonly pending = new Map<string, InstallPreview>();
  private readonly lifetime = new AbortController();
  private operation: Promise<unknown> | undefined;
  constructor(
    private readonly config: InstallerConfig,
    private readonly installBundle: (path: string) => Promise<BundleResult>,
  ) {}

  /** Resolve a clipboard message into an immutable preview before installation confirmation.
   * @param text Recent dsh://install clipboard link.
   * @returns A one-use ticket and the exact download plan displayed to the user.
   */
  async preview(text: string): Promise<InstallPreview> {
    this.lifetime.signal.throwIfAborted();
    const intent = parseInstallLink(text);
    if (!intent) throw new InstallError("invalid-message");
    const source = new URL(intent.source);
    const match = /^\/api\/catalog\/resources\/([a-f0-9]{32})\/install$/.exec(
      source.pathname,
    );
    if (!match || source.searchParams.get("version") !== intent.version)
      throw new InstallError("invalid-message");
    const data = await fetchBytes(
      source.href,
      this.config,
      this.lifetime.signal,
      false,
    );
    const response = z
      .object({ code: z.literal(0), data: Plan })
      .safeParse(JSON.parse(data.toString("utf8")));
    if (!response.success) throw new InstallError("invalid-plan");
    const plan = response.data.data;
    const message = Message.parse({
      ...intent,
      type: plan.kind,
      name: plan.name,
      ...(plan.sha256 ? { sha256: plan.sha256 } : {}),
    });
    if (plan.version !== intent.version || plan.resource_id !== match[1])
      throw new InstallError("invalid-plan");
    if (plan.kind === "plugin" && !plan.plugin_types?.includes("dsh_plugin"))
      throw new InstallError("unsupported-plugin");
    // Resolve the download host before showing a confirmation, without downloading the archive.
    const archive = new URL(plan.archive_url);
    if (
      archive.username ||
      archive.password ||
      archive.hash ||
      (!this.config.origins.includes(archive.origin) &&
        (archive.protocol !== "https:" ||
          !this.config.downloadHosts.includes(archive.hostname) ||
          (archive.port && archive.port !== "443")))
    )
      throw new InstallError("untrusted-source");
    for (const [key, value] of this.pending)
      if (value.message.ts < Date.now() / 1000 - MESSAGE_TTL_SECONDS)
        this.pending.delete(key);
    if (this.pending.size >= 10) throw new InstallError("busy");
    const preview = {
      ticket: randomUUID(),
      message,
      plan,
      target: plan.kind === "skill" ? this.config.skillRoot : "DSH",
    };
    this.pending.set(preview.ticket, preview);
    return preview;
  }

  /** Forget a dismissed preview without writing files.
   * @param ticket Preview ticket.
   */
  discard(ticket: string): void {
    this.pending.delete(ticket);
  }

  /** Download, verify and install exactly the plan shown for this one-use ticket.
   * @param ticket User-confirmed preview ticket.
   * @returns Actual installed directories or the native bundle activation outcome.
   */
  async install(ticket: string): Promise<Installed> {
    this.lifetime.signal.throwIfAborted();
    if (this.operation) throw new InstallError("busy");
    const preview = this.pending.get(ticket);
    const now = Math.floor(Date.now() / 1000);
    if (
      !preview ||
      preview.message.ts < now - MESSAGE_TTL_SECONDS ||
      preview.message.ts > now + 60
    )
      throw new InstallError("expired");
    this.pending.delete(ticket);
    this.operation = this.perform(preview);
    try {
      return (await this.operation) as Installed;
    } finally {
      this.operation = undefined;
    }
  }

  private async perform(preview: InstallPreview): Promise<Installed> {
    const plan = preview.plan,
      signal = this.lifetime.signal;
    const bytes = await fetchBytes(plan.archive_url, this.config, signal, true);
    if (plan.sha256 && !digestMatches(bytes, "sha256", plan.sha256, "hex"))
      throw new InstallError("integrity");
    if (plan.integrity) {
      const alternatives = plan.integrity
        .split(/\s+/)
        .map((item) => /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+=*)$/.exec(item))
        .filter((item) => item !== null);
      const strongest = ["sha512", "sha384", "sha256"].find((algorithm) =>
        alternatives.some((item) => item[1] === algorithm),
      );
      if (
        !strongest ||
        !alternatives.some(
          (item) =>
            item[1] === strongest &&
            digestMatches(bytes, strongest, item[2]!, "base64"),
        )
      )
        throw new InstallError("integrity");
    }
    await mkdir(this.config.cacheRoot, { recursive: true });
    const temporary = await mkdtemp(join(this.config.cacheRoot, "install-"));
    try {
      const archive = join(temporary, `resource.${plan.format}`);
      await writeFile(archive, bytes, { mode: 0o600 });
      const files = await readArchive(archive, plan.format, this.config);
      signal.throwIfAborted();
      if (plan.kind === "skill") {
        const paths = await this.installSkills(files, plan.skill_paths);
        return { kind: "skill", paths, restartRequired: false };
      }
      const manifestFile = files.find((file) => file.path === "package.json");
      if (!manifestFile) throw new InstallError("unsupported-plugin");
      const manifest = z
        .object({
          name: z.string().min(1),
          version: z.string().min(1),
          dsh: z.object({
            bundle: z.object({
              patch: z.union([z.string(), z.array(z.string())]).optional(),
              patches: z.array(z.string()).optional(),
            }),
          }),
        })
        .safeParse(JSON.parse(manifestFile.data.toString("utf8")));
      if (!manifest.success || manifest.data.name !== plan.name)
        throw new InstallError("unsupported-plugin");
      if (
        !/^commit-[a-f0-9]{12}$/.test(plan.version) &&
        manifest.data.version !== plan.version
      )
        throw new InstallError("invalid-plan");
      // Native manager owns profile locking, dependency resolution, build approval and activation.
      // Keep the package source after installation: the profile can retain a local tarball/path dependency.
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      const permanent = join(
        this.config.cacheRoot,
        contentHash + "-" + randomUUID(),
      );
      let spec: string;
      if (plan.requires_build) {
        const repo = new URL(plan.repository_url);
        if (
          repo.origin !== "https://github.com" ||
          repo.username ||
          repo.password ||
          repo.search ||
          repo.hash ||
          !/^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo.pathname) ||
          !/^[a-f0-9]{40}$/.test(plan.commit_sha || "")
        )
          throw new InstallError("untrusted-source");
        if (plan.version !== "commit-" + plan.commit_sha!.slice(0, 12))
          throw new InstallError("invalid-plan");
        // A local directory is linked by pnpm and skips its prepare step. The native
        // manager handles a commit-pinned Git source using its own build policy.
        spec = `github:${repo.pathname.slice(1)}#${plan.commit_sha}`;
      } else if (plan.format === "tgz") {
        await mkdir(permanent, { recursive: true });
        spec = join(permanent, "package.tgz");
        await writeFile(spec, bytes, { mode: 0o600 });
      } else {
        await mkdir(permanent, { recursive: true });
        spec = join(permanent, "package");
        await mkdir(spec, { recursive: true });
        await this.writeFiles(spec, files);
      }
      const outcome = await this.installBundle(spec);
      if (
        outcome.application !== "applied" &&
        outcome.application !== "restart-required"
      )
        throw new InstallError(
          outcome.error?.code === "already-installed"
            ? "already-installed"
            : "native-install",
        );
      return {
        kind: "plugin",
        paths: [spec],
        restartRequired: outcome.application === "restart-required",
      };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  private async writeFiles(root: string, files: ArchiveFile[]): Promise<void> {
    // Publish SKILL.md after its scripts/assets, so discovery never sees a half-written skill.
    for (const file of [...files].sort(
      (a, b) => Number(a.path === "SKILL.md") - Number(b.path === "SKILL.md"),
    )) {
      this.lifetime.signal.throwIfAborted();
      const target = join(root, safePath(file.path));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.data, {
        flag: "wx",
        mode: file.executable ? 0o755 : 0o644,
      });
    }
  }

  private async installSkills(
    files: ArchiveFile[],
    requested: string[] | undefined,
  ): Promise<string[]> {
    const entries = requested?.length
      ? requested
      : files
          .filter(
            (file) =>
              file.path === "SKILL.md" || file.path.endsWith("/SKILL.md"),
          )
          .map((file) => file.path);
    if (!entries.length) throw new InstallError("invalid-skill");
    const selections: { name: string; files: ArchiveFile[] }[] = [],
      seen = new Set<string>();
    for (const path of entries) {
      safePath(path);
      const entry = files.find((file) => file.path === path);
      const text = entry?.data.toString("utf8"),
        frontmatter =
          text && /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
      if (!frontmatter) throw new InstallError("invalid-skill");
      const document = parseDocument(frontmatter[1]!, { uniqueKeys: true });
      const data = z
        .object({
          name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
          description: z.string().min(1),
        })
        .safeParse(document.toJS({ maxAliasCount: 0 }));
      if (
        document.errors.length ||
        !data.success ||
        seen.has(data.data.name.toLowerCase())
      )
        throw new InstallError("invalid-skill");
      seen.add(data.data.name.toLowerCase());
      const prefix = path.slice(0, -"SKILL.md".length);
      selections.push({
        name: data.data.name,
        files: files
          .filter((file) => file.path.startsWith(prefix))
          .map((file) => ({ ...file, path: file.path.slice(prefix.length) })),
      });
    }
    await mkdir(this.config.skillRoot, { recursive: true });
    const actualRoot = await lstat(this.config.skillRoot);
    if (actualRoot.isSymbolicLink() || !actualRoot.isDirectory())
      throw new InstallError("unsafe-target");
    const owned: string[] = [];
    try {
      // Reserve every destination first; an existing skill is never replaced.
      for (const selection of selections) {
        const target = resolve(this.config.skillRoot, selection.name);
        try {
          await mkdir(target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST")
            throw new InstallError("already-installed");
          throw error;
        }
        owned.push(target);
      }
      for (const selection of selections) {
        await this.writeFiles(
          join(this.config.skillRoot, selection.name),
          selection.files,
        );
      }
      return owned;
    } catch (error) {
      for (const target of owned)
        await rm(target, { recursive: true, force: true });
      throw error;
    }
  }

  /** Abort downloads, refuse new requests, and await an already-admitted native operation. */
  async close(): Promise<void> {
    this.lifetime.abort();
    this.pending.clear();
    await this.operation?.catch(() => {
      /* The initiating RPC owns the failure report. */
    });
  }
}
