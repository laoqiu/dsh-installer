/** Anonymous bounded downloads; every redirect is checked against configured origins/hosts. */
import { InstallError } from "./errors.js";
import { fetchResource } from "./proxy.js";

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
export async function fetchBytes(
  input: string,
  policy: NetworkPolicy,
  signal: AbortSignal,
  archive: boolean,
): Promise<Buffer> {
  const timeout = AbortSignal.any([
    signal,
    AbortSignal.timeout(policy.timeoutMs),
  ]);
  let url = new URL(input);
  const failed = archive ? "download-failed" : "plan-failed";
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const own = policy.origins.includes(url.origin);
      if (
        url.username ||
        url.password ||
        url.hash ||
        (!own &&
          (url.protocol !== "https:" ||
            !policy.downloadHosts.includes(url.hostname) ||
            (url.port && url.port !== "443"))) ||
        (!archive && !own)
      )
        throw new InstallError("untrusted-source");
      const response = await fetchResource(url, {
        signal: timeout,
        redirect: "manual",
        credentials: "omit",
        headers: {
          // GitHub zipball rejects application/octet-stream with HTTP 415.
          Accept: archive ? "*/*" : "application/json",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.get("location");
        await response.body?.cancel();
        if (!next)
          throw new InstallError(failed, {
            host: url.hostname,
            status: response.status,
            reason: "redirect",
          });
        url = new URL(next, url);
        continue;
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new InstallError(
          response.status === 402 ? "paid-resource" : failed,
          {
            host: url.hostname,
            status: response.status,
            ...(!response.body ? { reason: "empty-response" as const } : {}),
          },
        );
      }
      const limit = archive ? policy.maxArchiveBytes : 1048576;
      const declared = Number(response.headers.get("content-length"));
      if (declared > limit) {
        await response.body.cancel();
        throw new InstallError("archive-limit");
      }
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) return Buffer.concat(chunks, size);
          size += part.value.byteLength;
          if (size > limit) throw new InstallError("archive-limit");
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {
          /* A failed transport is already reported above. */
        });
      }
    }
    throw new InstallError(failed, { host: url.hostname, reason: "redirect" });
  } catch (error) {
    if (error instanceof InstallError) throw error;
    if (signal.aborted) throw new InstallError("unloading");
    const cause = error instanceof Error ? error.cause : undefined;
    const code =
      cause && typeof cause === "object" && "code" in cause
        ? String(cause.code)
        : "";
    const timedOut =
      timeout.aborted ||
      code.includes("TIMEOUT") ||
      (error instanceof Error && error.name === "TimeoutError");
    const tls = /CERT|TLS|SSL/.test(code);
    throw new InstallError(failed, {
      host: url.hostname,
      reason: timedOut ? "timeout" : tls ? "tls" : "connect",
    });
  }
}
