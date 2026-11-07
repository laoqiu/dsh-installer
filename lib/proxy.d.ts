import { EnvHttpProxyAgent } from "undici";
interface WindowsProxy {
    enabled: number;
    server?: string;
    bypass?: string;
}
export declare function windowsProxyOptions(settings: WindowsProxy): {
    noProxy: string;
    httpsProxy?: string;
    httpProxy?: string;
} | undefined;
export declare function proxyDispatcher(input: URL | string): Promise<EnvHttpProxyAgent | undefined>;
export declare function closeProxy(): Promise<void>;
export declare function fetchResource(input: string | URL, options: {
    redirect: "manual" | "error";
    credentials: "omit";
    signal: AbortSignal;
    headers?: Record<string, string>;
}): Promise<import("undici").Response>;
export {};
