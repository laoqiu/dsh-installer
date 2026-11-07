/** Authenticated DSH Host adapter for free archive installation. */
import type { Context } from "@deepseek-ai/cordis";
import schema from "@deepseek-ai/schemastery";
export declare const name = "installer";
export declare const inject: string[];
export interface Config {
    dshHome?: string;
    origins?: string[];
    downloadHosts?: string[];
    timeoutMs?: number;
    maxArchiveBytes?: number;
    maxExpandedBytes?: number;
    maxFileBytes?: number;
    maxFiles?: number;
}
export declare const Config: schema<Schemastery.ObjectS<NoInfer<{
    dshHome: schema<string, string, "plain">;
    origins: schema<string[], string[], "defined">;
    downloadHosts: schema<string[], string[], "defined">;
    timeoutMs: schema<number, number, "defined">;
    maxArchiveBytes: schema<number, number, "defined">;
    maxExpandedBytes: schema<number, number, "defined">;
    maxFileBytes: schema<number, number, "defined">;
    maxFiles: schema<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    dshHome: schema<string, string, "plain">;
    origins: schema<string[], string[], "defined">;
    downloadHosts: schema<string[], string[], "defined">;
    timeoutMs: schema<number, number, "defined">;
    maxArchiveBytes: schema<number, number, "defined">;
    maxExpandedBytes: schema<number, number, "defined">;
    maxFileBytes: schema<number, number, "defined">;
    maxFiles: schema<number, number, "defined">;
}>>, "plain">;
/** Register the installer using the existing authenticated DSH connection.
 * @param ctx Host connection and native plugin manager.
 * @param config Resource service origins and bounded archive limits.
 */
export declare function apply(ctx: Context, config?: Config): void;
