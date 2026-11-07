/** Stable installer errors translated by the Client. */
import type { FailureDetails } from "./protocol.js";

export class InstallError extends Error {
  constructor(
    readonly code: string,
    readonly details?: FailureDetails,
  ) {
    super(code);
  }
}
