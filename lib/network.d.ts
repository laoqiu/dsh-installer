export interface NetworkPolicy {
    origins: string[];
    downloadHosts: string[];
    timeoutMs: number;
    maxArchiveBytes: number;
}
/** Fetch a URL without forwarding browser sessions or accepting an unchecked redirect.
 * @param input URL to request.
 * @param policy Configured source origins, archive hosts and limits.
 * @param signal Installer lifetime cancellation.
 * @param archive Whether the response is a compressed archive rather than a source plan.
 * @returns The complete response bytes within the relevant size limit.
 */
export declare function fetchBytes(input: string, policy: NetworkPolicy, signal: AbortSignal, archive: boolean): Promise<Buffer>;
