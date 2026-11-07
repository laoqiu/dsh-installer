/** Global activation listener and native DSH installation confirmation. */
import type { Context } from "@deepseek-ai/cordis";
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type { SnapshotStore } from "@deepseek-ai/dsh-client-store";
import type { InjectFace, PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
import { Button, Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import { z } from "zod";
import { ClipboardMonitor } from "./clipboard.js";
import {
  parseInstallLink,
  PREFIX,
  Preview,
  Failure,
  type FailureDetails,
  type InstallPreview,
} from "./protocol.js";
import { en, zh, type Key } from "./locales.js";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    "dsh-installer": Key;
  }
}
declare module "@deepseek-ai/cordis" {
  interface Context {
    connection: ConnectionHandle;
  }
}

interface State {
  phase: "idle" | "previewing" | "ready" | "installing" | "done" | "error";
  preview: InstallPreview | null;
  code: Key;
  restart: boolean;
  failure: FailureDetails | null;
}
interface Actions {
  hooks: { installer: Pick<SnapshotStore<State>, "getSnapshot" | "subscribe"> };
  preview(text: string): Promise<void>;
  install(): Promise<void>;
  dismiss(): void;
}
type Props = InjectFace<Actions> & PropsLocale<"dsh-installer">;

function InstallationOverlay(props: Props) {
  const state = props.useInstaller((value) => value),
    { t } = props;
  const busy = state.phase === "installing" || state.phase === "previewing";
  const done = state.phase === "done";
  const error = state.phase === "error";
  const preview = state.preview;
  return (
    <Modal
      open={state.phase !== "idle"}
      title={t(done ? "installed" : error ? "error" : "title")}
      closeLabel={t("close")}
      onClose={() => {
        if (!busy) props.dismiss();
      }}
      footer={
        <div className="dshi-actions">
          <Button variant="outline" disabled={busy} onClick={props.dismiss}>
            {t(done || error ? "close" : "cancel")}
          </Button>
          {(state.phase === "ready" || state.phase === "installing") && (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                void props.install();
              }}
            >
              {t(state.phase === "installing" ? "installing" : "confirm")}
            </Button>
          )}
        </div>
      }
    >
      {state.phase === "previewing" && <p role="status">{t("loading")}</p>}
      {preview && (
        <div className="dshi-details">
          <strong>{preview.message.name}</strong>
          <dl>
            <dt>{t("version")}</dt>
            <dd>{preview.plan.version}</dd>
            <dt>{t("source")}</dt>
            <dd>{new URL(preview.message.source).origin}</dd>
            <dt>{t("archive")}</dt>
            <dd>{preview.plan.archive_url}</dd>
            <dt>{t("target")}</dt>
            <dd>{preview.target}</dd>
            {preview.plan.sha256 && (
              <>
                <dt>{t("checksum")}</dt>
                <dd>{preview.plan.sha256}</dd>
              </>
            )}
          </dl>
        </div>
      )}
      {error && (
        <p role="alert">
          {t(state.code)}
          {state.failure?.host && <> {state.failure.host}</>}
          {state.failure?.status && <> · HTTP {state.failure.status}</>}
          {state.failure?.reason === "timeout" && (
            <> · {t("request-timeout")}</>
          )}
          {state.failure?.reason === "tls" && <> · {t("request-tls")}</>}
        </p>
      )}
      {state.phase === "done" && (
        <p role="status">{t(state.restart ? "restart" : "installed")}</p>
      )}
    </Modal>
  );
}

export const name = "installer";
export const inject = ["slots", "locale", "connection"];

/** Mount one application-wide listener; no settings page needs to be open.
 * @param ctx Native Client connection, locale and overlay registries.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register("dsh-installer", { en, zh }));
  let disposed = false;
  let checkClipboard = async () => {};
  let state: State = {
    phase: "idle",
    preview: null,
    code: "operation-failed",
    restart: false,
    failure: null,
  };
  const listeners = new Set<() => void>();
  const update = (value: Partial<State>) => {
    if (!disposed) {
      state = { ...state, ...value };
      for (const listener of listeners) listener();
    }
  };
  const store = {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const acceptsClipboard = () =>
    ["idle", "ready", "done", "error"].includes(state.phase);
  class RequestError extends Error {
    constructor(
      code: string,
      readonly details?: FailureDetails,
    ) {
      super(code);
    }
  }
  async function call(method: string, payload: object): Promise<unknown> {
    let reply;
    try {
      reply = await ctx.connection.rpc.call("/api", PREFIX + method, payload);
    } catch (error) {
      const status =
        error instanceof Error ? /HTTP (\d{3})/.exec(error.message) : null;
      throw new RequestError(
        "client-connection",
        status ? { status: Number(status[1]) } : undefined,
      );
    }
    if (!reply.ok) throw new RequestError("client-connection");
    const response = z
      .discriminatedUnion("ok", [
        z.object({ ok: z.literal(true), value: z.unknown() }),
        z.object({
          ok: z.literal(false),
          code: z.string(),
          details: Failure.optional(),
        }),
      ])
      .parse(reply.value);
    if (!response.ok) throw new RequestError(response.code, response.details);
    return response.value;
  }
  const fail = (error: unknown) => {
    const key = error instanceof Error ? error.message : "";
    update({
      phase: "error",
      code: Object.hasOwn(zh, key) ? (key as Key) : "operation-failed",
      failure: error instanceof RequestError ? (error.details ?? null) : null,
    });
  };
  const actions: Actions = {
    hooks: { installer: store },
    async preview(text) {
      if (
        disposed ||
        state.phase === "installing" ||
        state.phase === "previewing"
      )
        return;
      if (!parseInstallLink(text)) {
        fail(new Error("invalid-message"));
        return;
      }
      if (state.preview)
        void call("discard", { ticket: state.preview.ticket }).catch(() => {
          /* A discarded ticket expires at the Host. */
        });
      update({ phase: "previewing", preview: null, failure: null });
      try {
        update({
          phase: "ready",
          preview: Preview.parse(await call("preview", { text })),
        });
      } catch (error) {
        fail(error);
      }
    },
    async install() {
      if (state.phase !== "ready" || !state.preview) return;
      const ticket = state.preview.ticket;
      update({ phase: "installing", failure: null });
      try {
        const result = z
          .object({
            kind: z.enum(["skill", "plugin"]),
            paths: z.array(z.string()),
            restartRequired: z.boolean(),
          })
          .parse(await call("install", { ticket }));
        update({ phase: "done", restart: result.restartRequired });
      } catch (error) {
        fail(error);
      }
    },
    dismiss() {
      if (state.phase === "installing" || state.phase === "previewing") return;
      if (state.preview)
        void call("discard", { ticket: state.preview.ticket }).catch(() => {
          /* This ticket also has a bounded lifetime. */
        });
      update({ phase: "idle", preview: null, failure: null });
      checkClipboard();
    },
  };
  ctx.effect(() =>
    ctx.slots.inject("shell.overlay", () =>
      ctx.slots.register(
        {
          name: "shell.overlay",
          id: "dsh-installer.confirm",
          locale: "dsh-installer",
          inject: () => actions,
        },
        InstallationOverlay,
      ),
    ),
  );
  ctx.effect(() => {
    const style = document.createElement("style");
    style.textContent =
      ".dshi-actions{display:flex;justify-content:flex-end;gap:8px}.dshi-details{display:grid;gap:16px}.dshi-details dl{display:grid;grid-template-columns:80px minmax(0,1fr);gap:12px;font-size:14px;line-height:20px}.dshi-details dt{opacity:.65}.dshi-details dd{margin:0;overflow-wrap:anywhere}";
    document.head.appendChild(style);
    return () => style.remove();
  });
  ctx.effect(() => {
    const monitor = new ClipboardMonitor(
      () => navigator.clipboard.readText(),
      (text) => navigator.clipboard.writeText(text),
      async (text) => {
        if (acceptsClipboard()) await actions.preview(text);
      },
    );
    const check = async () => {
      if (
        location.protocol === "dsh-app:" &&
        ctx.connection.isLoopback &&
        ctx.connection.generation.getSnapshot() &&
        document.hasFocus() &&
        acceptsClipboard()
      )
        await monitor.check();
    };
    checkClipboard = check;
    const visible = () => {
      if (document.visibilityState === "visible") check();
    };
    // Electron can report focus before restoring the document's visibility state.
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", visible);
    const unsubscribe = ctx.connection.generation.subscribe(() => {
      void check();
    });
    visible();
    return () => {
      monitor.close();
      checkClipboard = async () => {};
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", visible);
      unsubscribe();
    };
  });
  ctx.effect(() => () => {
    disposed = true;
    listeners.clear();
  });
}
