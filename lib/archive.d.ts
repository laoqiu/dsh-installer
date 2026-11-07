export interface ArchiveLimits {
    maxFiles: number;
    maxExpandedBytes: number;
    maxFileBytes: number;
}
export interface ArchiveFile {
    path: string;
    data: Buffer;
    executable: boolean;
}
/** Validate a portable relative path before any filesystem write.
 * @param value Archive entry path.
 * @returns The path without a trailing directory separator.
 */
export declare function safePath(value: string): string;
/** Read bounded regular files and reject symlinks, duplicates and path traversal.
 * @param file Local downloaded archive.
 * @param format Archive format supplied by the free installation plan.
 * @param limits Expanded file count and byte limits.
 * @returns Regular files with one common wrapper directory removed.
 */
export declare function readArchive(file: string, format: "zip" | "tgz", limits: ArchiveLimits): Promise<ArchiveFile[]>;
