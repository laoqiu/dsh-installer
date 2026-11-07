import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import schema from "@deepseek-ai/schemastery";
import { join } from "node:path";
import { z } from "zod";
import { FreeInstaller } from "./installer.js";
import { InstallError } from "./errors.js";
import { PREFIX, requests } from "./protocol.js";
import { closeProxy } from "./proxy.js";
export const name = "installer";
export const inject = ["connection", "pluginManager"];
export const Config = schema.object({
    dshHome: schema.string(),
    origins: schema
        .array(schema.string())
        .default(["https://antistudio.cn", "https://www.antistudio.cn"]),
    downloadHosts: schema
        .array(schema.string())
        .default([
        "github.com",
        "api.github.com",
        "codeload.github.com",
        "release-assets.githubusercontent.com",
        "objects.githubusercontent.com",
        "registry.npmjs.org",
    ]),
    timeoutMs: schema.number().min(1000).default(120000),
    maxArchiveBytes: schema.number().min(1024).default(67108864),
    maxExpandedBytes: schema.number().min(1024).default(134217728),
    maxFileBytes: schema.number().min(1024).default(16777216),
    maxFiles: schema.number().min(1).default(10000),
});
/** Register the installer using the existing authenticated DSH connection.
 * @param ctx Host connection and native plugin manager.
 * @param config Resource service origins and bounded archive limits.
 */
export function apply(ctx, config = {}) {
    const home = resolveDshHome(config.dshHome);
    const origins = config.origins ?? [
        "https://antistudio.cn",
        "https://www.antistudio.cn",
    ];
    for (const value of origins) {
        const url = new URL(value);
        if (url.origin !== value ||
            url.username ||
            url.password ||
            (url.protocol !== "https:" &&
                !(url.protocol === "http:" &&
                    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))))
            throw new Error("dsh-installer: origins must be HTTPS origins or explicit loopback development origins");
    }
    const limits = {
        timeoutMs: config.timeoutMs ?? 120000,
        maxArchiveBytes: config.maxArchiveBytes ?? 67108864,
        maxExpandedBytes: config.maxExpandedBytes ?? 134217728,
        maxFileBytes: config.maxFileBytes ?? 16777216,
        maxFiles: config.maxFiles ?? 10000,
    };
    if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1))
        throw new Error("dsh-installer: limits must be positive integers");
    const installer = new FreeInstaller({
        ...limits,
        origins,
        downloadHosts: config.downloadHosts ?? [
            "github.com",
            "api.github.com",
            "codeload.github.com",
            "release-assets.githubusercontent.com",
            "objects.githubusercontent.com",
            "registry.npmjs.org",
        ],
        skillRoot: join(home, "skills"),
        cacheRoot: join(home, "installer", "packages"),
    }, (path) => ctx.pluginManager.installBundle(path, { saveExact: true }));
    let closing = false;
    for (const method of Object.keys(requests)) {
        ctx.effect(() => ctx.connection.fetch.register({
            path: `/api/${PREFIX}${method}`,
            methods: ["POST"],
            requestBody: "buffered",
            async fetch(request) {
                if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
                    "application/json")
                    return new Response("Expected application/json", { status: 415 });
                let input;
                try {
                    input = z
                        .object({
                        type: z.literal("client-request"),
                        rpcId: z.string().max(128),
                        method: z.literal(PREFIX + method),
                        payload: z.unknown(),
                    })
                        .parse(await request.json());
                    requests[method].parse(input.payload);
                }
                catch {
                    return new Response("Invalid installer request", { status: 400 });
                }
                let value;
                try {
                    if (closing)
                        throw new InstallError("unloading");
                    if (method === "preview")
                        value = await installer.preview(requests.preview.parse(input.payload).text);
                    else if (method === "install")
                        value = await installer.install(requests.install.parse(input.payload).ticket);
                    else if (method === "discard") {
                        installer.discard(requests.discard.parse(input.payload).ticket);
                        value = {};
                    }
                    value = { ok: true, value };
                }
                catch (error) {
                    value = {
                        ok: false,
                        ...(error instanceof InstallError && error.details
                            ? { details: error.details }
                            : {}),
                        code: error instanceof InstallError ? error.code : "operation-failed",
                    };
                }
                return Response.json({
                    type: "server-response",
                    rpcId: input.rpcId,
                    result: { ok: true, value },
                });
            },
        }));
    }
    ctx.effect(() => async () => {
        closing = true;
        await installer.close();
        await closeProxy();
    });
}
