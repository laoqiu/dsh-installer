/** Event-driven clipboard admission, shared by startup/focus/visibility handlers. */
import { parseInstallLink } from "./protocol.js";
/** Suppress repeated clipboard prompts without polling or storing ordinary clipboard text. */
export class ClipboardMonitor {
    read;
    write;
    receive;
    busy = false;
    closed = false;
    seen = new Set();
    constructor(read, write, receive) {
        this.read = read;
        this.write = write;
        this.receive = receive;
    }
    /** Check the clipboard once after a user-visible activation; unreadable/unrelated text is ignored. */
    async check() {
        if (this.busy || this.closed)
            return;
        this.busy = true;
        try {
            const text = await this.read();
            if (this.closed)
                return;
            const message = parseInstallLink(text);
            if (!message)
                return;
            // Consume before preview/network/UI. Leave any subsequently copied content alone.
            const current = await this.read();
            if (this.closed || current !== text)
                return;
            await this.write("");
            if (this.closed)
                return;
            const key = message.source + "\n" + message.nonce;
            if (this.seen.has(key))
                return;
            this.seen.add(key);
            if (this.seen.size > 100)
                this.seen.delete(this.seen.values().next().value);
            await this.receive(text);
        }
        catch {
            /* Clipboard permission may be unavailable; retry on the next activation. */
        }
        finally {
            this.busy = false;
        }
    }
    /** Stop admitting late clipboard reads when the Client plugin unloads. */
    close() {
        this.closed = true;
        this.seen.clear();
    }
}
