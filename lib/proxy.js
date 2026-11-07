/** Per-request proxy support; never changes the Host's global HTTP dispatcher. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EnvHttpProxyAgent, fetch as request } from "undici";
const execute = promisify(execFile);
export function windowsProxyOptions(settings) {
    if (settings.enabled !== 1 || !settings.server)
        return undefined;
    const entries = new Map();
    for (const item of settings.server.split(";")) {
        const at = item.indexOf("=");
        if (at > 0)
            entries.set(item.slice(0, at).trim().toLowerCase(), item.slice(at + 1).trim());
        else if (item.trim()) {
            entries.set("http", item.trim());
            entries.set("https", item.trim());
        }
    }
    const normalize = (value) => {
        if (!value)
            return undefined;
        const url = new URL(value.includes("://") ? value : "http://" + value);
        return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
    };
    const httpProxy = normalize(entries.get("http"));
    const httpsProxy = normalize(entries.get("https") || entries.get("http"));
    if (!httpProxy && !httpsProxy)
        return undefined;
    return {
        ...(httpProxy ? { httpProxy } : {}),
        ...(httpsProxy ? { httpsProxy } : {}),
        noProxy: (settings.bypass || "")
            .split(";")
            .filter((item) => item && item !== "<local>")
            .join(","),
    };
}
async function systemOptions() {
    if (process.platform !== "win32")
        return undefined;
    const command = "$s=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; @{enabled=[int]$s.ProxyEnable;server=[string]$s.ProxyServer;bypass=[string]$s.ProxyOverride}|ConvertTo-Json -Compress";
    try {
        const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 5000, maxBuffer: 16384, encoding: "utf8" });
        return windowsProxyOptions(JSON.parse(stdout));
    }
    catch {
        return undefined;
    }
}
let agent;
export async function proxyDispatcher(input) {
    const url = new URL(input);
    if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
        return undefined;
    agent ??= (async () => {
        const hasEnvironment = Boolean(process.env.https_proxy ||
            process.env.HTTPS_PROXY ||
            process.env.http_proxy ||
            process.env.HTTP_PROXY);
        const options = hasEnvironment ? {} : await systemOptions();
        return hasEnvironment || options
            ? new EnvHttpProxyAgent(options)
            : undefined;
    })();
    return agent;
}
export async function closeProxy() {
    const active = agent;
    agent = undefined;
    await (await active)?.close();
}
export async function fetchResource(input, options) {
    const dispatcher = await proxyDispatcher(input);
    return request(input, { ...options, ...(dispatcher ? { dispatcher } : {}) });
}
