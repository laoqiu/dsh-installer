/** Clipboard install links and authenticated Host request validation; no Node imports. */
import { z } from "zod";
export declare const PREFIX = "dsh-installer/";
export declare const Failure: z.ZodObject<{
    host: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodNumber>;
    reason: z.ZodOptional<z.ZodEnum<{
        timeout: "timeout";
        tls: "tls";
        connect: "connect";
        redirect: "redirect";
        "empty-response": "empty-response";
        "invalid-response": "invalid-response";
    }>>;
}, z.core.$strip>;
export type FailureDetails = z.infer<typeof Failure>;
export declare const MESSAGE_TTL_SECONDS = 600;
export declare const Message: z.ZodObject<{
    type: z.ZodEnum<{
        skill: "skill";
        plugin: "plugin";
    }>;
    name: z.ZodString;
    version: z.ZodString;
    source: z.ZodString;
    nonce: z.ZodString;
    ts: z.ZodNumber;
    sha256: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export interface InstallLink {
    source: string;
    version: string;
    nonce: string;
    ts: number;
}
/** Parse clipboard install links; the Host checks the allowed origin before any request. */
export declare function parseInstallLink(text: string, now?: number): InstallLink | null;
export declare const Plan: z.ZodObject<{
    resource_id: z.ZodString;
    kind: z.ZodEnum<{
        skill: "skill";
        plugin: "plugin";
    }>;
    name: z.ZodString;
    version: z.ZodString;
    archive_url: z.ZodString;
    format: z.ZodEnum<{
        zip: "zip";
        tgz: "tgz";
    }>;
    amount_cents: z.ZodLiteral<0>;
    sha256: z.ZodOptional<z.ZodString>;
    integrity: z.ZodOptional<z.ZodString>;
    commit_sha: z.ZodOptional<z.ZodString>;
    requires_build: z.ZodOptional<z.ZodBoolean>;
    repository_url: z.ZodString;
    skill_paths: z.ZodOptional<z.ZodArray<z.ZodString>>;
    plugin_types: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        dsh_plugin: "dsh_plugin";
        agent_plugin: "agent_plugin";
        mcp: "mcp";
        mcp_apps: "mcp_apps";
    }>>>;
    platforms: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type InstallationPlan = z.infer<typeof Plan>;
export declare const Preview: z.ZodObject<{
    ticket: z.ZodString;
    message: z.ZodObject<{
        type: z.ZodEnum<{
            skill: "skill";
            plugin: "plugin";
        }>;
        name: z.ZodString;
        version: z.ZodString;
        source: z.ZodString;
        nonce: z.ZodString;
        ts: z.ZodNumber;
        sha256: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    plan: z.ZodObject<{
        resource_id: z.ZodString;
        kind: z.ZodEnum<{
            skill: "skill";
            plugin: "plugin";
        }>;
        name: z.ZodString;
        version: z.ZodString;
        archive_url: z.ZodString;
        format: z.ZodEnum<{
            zip: "zip";
            tgz: "tgz";
        }>;
        amount_cents: z.ZodLiteral<0>;
        sha256: z.ZodOptional<z.ZodString>;
        integrity: z.ZodOptional<z.ZodString>;
        commit_sha: z.ZodOptional<z.ZodString>;
        requires_build: z.ZodOptional<z.ZodBoolean>;
        repository_url: z.ZodString;
        skill_paths: z.ZodOptional<z.ZodArray<z.ZodString>>;
        plugin_types: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            dsh_plugin: "dsh_plugin";
            agent_plugin: "agent_plugin";
            mcp: "mcp";
            mcp_apps: "mcp_apps";
        }>>>;
        platforms: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    target: z.ZodString;
}, z.core.$strip>;
export type InstallPreview = z.infer<typeof Preview>;
export declare const requests: {
    preview: z.ZodObject<{
        text: z.ZodString;
    }, z.core.$strict>;
    install: z.ZodObject<{
        ticket: z.ZodString;
    }, z.core.$strict>;
    discard: z.ZodObject<{
        ticket: z.ZodString;
    }, z.core.$strict>;
};
