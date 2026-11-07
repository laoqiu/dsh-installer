/** Clipboard install links and authenticated Host request validation; no Node imports. */
import { z } from "zod";
export const PREFIX = "dsh-installer/";
export const Failure = z.object({
    host: z
        .string()
        .regex(/^[a-zA-Z0-9.:[\]-]{1,253}$/)
        .optional(),
    status: z.number().int().min(100).max(599).optional(),
    reason: z
        .enum([
        "timeout",
        "tls",
        "connect",
        "redirect",
        "empty-response",
        "invalid-response",
    ])
        .optional(),
});
export const MESSAGE_TTL_SECONDS = 600;
export const Message = z
    .object({
    type: z.enum(["skill", "plugin"]),
    name: z.string().min(1).max(256),
    version: z.string().min(1).max(64),
    source: z.string().url().max(2048),
    nonce: z.string().regex(/^[a-zA-Z0-9_-]{6,128}$/),
    ts: z.number().int().positive(),
    sha256: z
        .string()
        .regex(/^[a-fA-F0-9]{64}$/)
        .optional(),
})
    .strict();
/** Parse clipboard install links; the Host checks the allowed origin before any request. */
export function parseInstallLink(text, now = Math.floor(Date.now() / 1000)) {
    if (text.length > 8192)
        return null;
    try {
        const value = text.trim();
        if (!/^dsh:\/\/install(?:[/?]|$)/i.test(value))
            return null;
        const link = new URL(value);
        if (link.protocol !== "dsh:" ||
            link.hostname.toLowerCase() !== "install" ||
            link.username ||
            link.password ||
            link.port ||
            link.hash ||
            !["", "/"].includes(link.pathname) ||
            link.searchParams.getAll("source").length !== 1 ||
            [...link.searchParams.keys()].some((key) => !["source", "nonce", "ts"].includes(key)))
            return null;
        const source = new URL(link.searchParams.get("source"));
        if (source.username ||
            source.password ||
            source.hash ||
            !/^\/api\/catalog\/resources\/[a-f0-9]{32}\/install$/.test(source.pathname) ||
            source.searchParams.getAll("version").length !== 1 ||
            [...source.searchParams.keys()].some((key) => key !== "version") ||
            (source.protocol !== "https:" &&
                !(source.protocol === "http:" &&
                    ["localhost", "127.0.0.1", "[::1]"].includes(source.hostname))))
            return null;
        if (source.href.length > 2048)
            return null;
        const version = source.searchParams.get("version");
        if (!version || version.length > 64 || /[\x00-\x1f]/.test(version))
            return null;
        const hasMetadata = link.searchParams.has("nonce") || link.searchParams.has("ts");
        let nonce = "clipboard-link", ts = now;
        if (hasMetadata) {
            if (link.searchParams.getAll("nonce").length !== 1 ||
                link.searchParams.getAll("ts").length !== 1)
                return null;
            nonce = link.searchParams.get("nonce");
            const stamp = link.searchParams.get("ts");
            if (!/^[a-zA-Z0-9_-]{6,128}$/.test(nonce) || !/^\d+$/.test(stamp))
                return null;
            ts = Number(stamp);
            if (!Number.isSafeInteger(ts) ||
                ts < now - MESSAGE_TTL_SECONDS ||
                ts > now + 60)
                return null;
        }
        return { source: source.href, version, nonce, ts };
    }
    catch {
        return null;
    }
}
export const Plan = z.object({
    resource_id: z.string().regex(/^[a-f0-9]{32}$/),
    kind: z.enum(["skill", "plugin"]),
    name: z.string().min(1).max(214),
    version: z.string().min(1).max(64),
    archive_url: z.string().url().max(2048),
    format: z.enum(["zip", "tgz"]),
    amount_cents: z.literal(0),
    sha256: z
        .string()
        .regex(/^[a-fA-F0-9]{64}$/)
        .optional(),
    integrity: z.string().max(1024).optional(),
    commit_sha: z.string().optional(),
    requires_build: z.boolean().optional(),
    repository_url: z.string(),
    skill_paths: z.array(z.string().max(1024)).max(1000).optional(),
    plugin_types: z
        .array(z.enum(["dsh_plugin", "agent_plugin", "mcp", "mcp_apps"]))
        .optional(),
    platforms: z.array(z.string()),
});
export const Preview = z.object({
    ticket: z.string().uuid(),
    message: Message,
    plan: Plan,
    target: z.string(),
});
export const requests = {
    preview: z.object({ text: z.string().max(16384) }).strict(),
    install: z.object({ ticket: z.string().uuid() }).strict(),
    discard: z.object({ ticket: z.string().uuid() }).strict(),
};
