import { type ArchiveLimits } from "./archive.js";
import { type NetworkPolicy } from "./network.js";
import { type InstallPreview } from "./protocol.js";
export interface InstallerConfig extends NetworkPolicy, ArchiveLimits {
    skillRoot: string;
    cacheRoot: string;
}
export interface BundleResult {
    application: string;
    error?: {
        code: string;
    };
    restartReason?: string;
}
export interface Installed {
    kind: "skill" | "plugin";
    paths: string[];
    restartRequired: boolean;
}
/** Own previews and one serial filesystem/package operation for the plugin lifetime. */
export declare class FreeInstaller {
    private readonly config;
    private readonly installBundle;
    private readonly pending;
    private readonly lifetime;
    private operation;
    constructor(config: InstallerConfig, installBundle: (path: string) => Promise<BundleResult>);
    /** Resolve a clipboard message into an immutable preview before installation confirmation.
     * @param text Recent dsh://install clipboard link.
     * @returns A one-use ticket and the exact download plan displayed to the user.
     */
    preview(text: string): Promise<InstallPreview>;
    /** Forget a dismissed preview without writing files.
     * @param ticket Preview ticket.
     */
    discard(ticket: string): void;
    /** Download, verify and install exactly the plan shown for this one-use ticket.
     * @param ticket User-confirmed preview ticket.
     * @returns Actual installed directories or the native bundle activation outcome.
     */
    install(ticket: string): Promise<Installed>;
    private perform;
    private writeFiles;
    private installSkills;
    /** Abort downloads, refuse new requests, and await an already-admitted native operation. */
    close(): Promise<void>;
}
