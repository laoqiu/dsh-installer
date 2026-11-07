/** Stable installer errors translated by the Client. */
import type { FailureDetails } from "./protocol.js";
export declare class InstallError extends Error {
    readonly code: string;
    readonly details?: FailureDetails | undefined;
    constructor(code: string, details?: FailureDetails | undefined);
}
