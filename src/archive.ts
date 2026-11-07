/** Read ZIP/TGZ archives without extracting links or trusting archive paths. */
import { readFile } from "node:fs/promises";
import { crc32 } from "node:zlib";
import { t as readTar } from "tar";
import { fromBuffer } from "yauzl";
import { InstallError } from "./errors.js";

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
export function safePath(value: string): string {
  const path = value.replace(/\/$/, "");
  if (
    !path ||
    path.length > 1024 ||
    /[\\\x00-\x1f<>:"|?*]/.test(path) ||
    path.startsWith("/") ||
    path
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[. ]$/.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    throw new InstallError("unsafe-archive");
  return path;
}

/** Read bounded regular files and reject symlinks, duplicates and path traversal.
 * @param file Local downloaded archive.
 * @param format Archive format supplied by the free installation plan.
 * @param limits Expanded file count and byte limits.
 * @returns Regular files with one common wrapper directory removed.
 */
export async function readArchive(
  file: string,
  format: "zip" | "tgz",
  limits: ArchiveLimits,
): Promise<ArchiveFile[]> {
  const files: ArchiveFile[] = [],
    names = new Set<string>();
  let total = 0,
    count = 0;
  const admit = (path: string, size: number, directory: boolean) => {
    path = safePath(path);
    const key = path.toLowerCase();
    if (
      names.has(key) ||
      ++count > limits.maxFiles ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > limits.maxFileBytes
    )
      throw new InstallError("unsafe-archive");
    names.add(key);
    if (!directory && (total += size) > limits.maxExpandedBytes)
      throw new InstallError("archive-limit");
    return path;
  };
  if (format === "tgz") {
    let failure: unknown;
    await readTar({
      file,
      strict: true,
      onReadEntry(entry) {
        try {
          if (failure) {
            entry.resume();
            return;
          }
          if (entry.type !== "File" && entry.type !== "Directory")
            throw new InstallError("unsafe-archive");
          const path = admit(
            entry.path,
            entry.size,
            entry.type === "Directory",
          );
          if (entry.type === "Directory") {
            entry.resume();
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          entry.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > entry.size || bytes > limits.maxFileBytes) {
              failure = new InstallError("archive-limit");
              return;
            }
            if (!failure) chunks.push(chunk);
          });
          entry.on("end", () => {
            if (bytes !== entry.size)
              failure = new InstallError("unsafe-archive");
            if (!failure)
              files.push({
                path,
                data: Buffer.concat(chunks),
                executable: Boolean((entry.mode ?? 0) & 0o111),
              });
          });
        } catch (error) {
          failure = error;
          entry.resume();
        }
      },
    });
    if (failure) throw failure;
  } else {
    const buffer = await readFile(file);
    await new Promise<void>((resolve, reject) => {
      fromBuffer(
        buffer,
        { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
        (error, zip) => {
          if (error || !zip) {
            reject(new InstallError("unsafe-archive"));
            return;
          }
          const fail = (cause: unknown) => {
            zip.close();
            reject(cause);
          };
          zip.on("error", fail);
          zip.on("end", resolve);
          zip.on("entry", (entry) => {
            try {
              const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
              if (
                (mode !== 0 && mode !== 0o100000 && mode !== 0o040000) ||
                entry.generalPurposeBitFlag & 1
              )
                throw new InstallError("unsafe-archive");
              const directory = entry.fileName.endsWith("/");
              const path = admit(
                entry.fileName,
                entry.uncompressedSize,
                directory,
              );
              if (directory) {
                zip.readEntry();
                return;
              }
              zip.openReadStream(entry, (error, stream) => {
                if (error || !stream) {
                  fail(new InstallError("unsafe-archive"));
                  return;
                }
                const chunks: Buffer[] = [];
                let bytes = 0;
                stream.on("error", fail);
                stream.on("data", (chunk: Buffer) => {
                  bytes += chunk.length;
                  if (
                    bytes > entry.uncompressedSize ||
                    bytes > limits.maxFileBytes
                  ) {
                    stream.destroy();
                    fail(new InstallError("archive-limit"));
                    return;
                  }
                  chunks.push(chunk);
                });
                stream.on("end", () => {
                  if (bytes !== entry.uncompressedSize) {
                    fail(new InstallError("unsafe-archive"));
                    return;
                  }
                  const data = Buffer.concat(chunks);
                  if (crc32(data) !== entry.crc32) {
                    fail(new InstallError("integrity"));
                    return;
                  }
                  files.push({
                    path,
                    data,
                    executable: Boolean(
                      (entry.externalFileAttributes >>> 16) & 0o111,
                    ),
                  });
                  zip.readEntry();
                });
              });
            } catch (error) {
              fail(error);
            }
          });
          zip.readEntry();
        },
      );
    });
  }
  if (!files.length) throw new InstallError("unsafe-archive");
  const wrapper = files[0]!.path.split("/")[0]! + "/";
  return files.every((item) => item.path.startsWith(wrapper))
    ? files.map((item) => ({ ...item, path: item.path.slice(wrapper.length) }))
    : files;
}
