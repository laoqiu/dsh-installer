/** Suppress repeated clipboard prompts without polling or storing ordinary clipboard text. */
export declare class ClipboardMonitor {
    private readonly read;
    private readonly write;
    private readonly receive;
    private busy;
    private closed;
    private readonly seen;
    constructor(read: () => Promise<string>, write: (text: string) => Promise<void>, receive: (text: string) => Promise<void>);
    /** Check the clipboard once after a user-visible activation; unreadable/unrelated text is ignored. */
    check(): Promise<void>;
    /** Stop admitting late clipboard reads when the Client plugin unloads. */
    close(): void;
}
