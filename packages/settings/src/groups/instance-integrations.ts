import { z } from "zod";
import {
  defineGroup,
  defineSetting,
  INSTANCE_ONLY,
  wholeNumber,
} from "../define.js";

/**
 * The resource scopes the MCP server enforces: read access, and write access
 * gated behind it. Every MCP tool declares one, an instance may offer only
 * some of them (`instance-integrations.mcpToolGroups`), and Protected Resource
 * Metadata and `WWW-Authenticate` challenges advertise only these.
 */
export const MCP_SCOPES = ["read", "write"] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

/**
 * The scopes the MCP OAuth Authorization Server accepts: the resource scopes
 * plus `offline_access` so clients can obtain and rotate refresh tokens.
 */
export const MCP_AUTH_SCOPES = [...MCP_SCOPES, "offline_access"] as const;

const MCP_SCOPE_LABELS: Record<McpScope, string> = {
  read: "Read",
  write: "Change",
};

/** The levels a server log line is written at, lowest first. */
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  debug: "Debug",
  info: "Info",
  warn: "Warnings",
  error: "Errors only",
};

export const group = defineGroup({
  id: "instance-integrations",
  section: "instance",
  label: "Integrations",
  description: "What AI agents may do here, and what the server logs.",
  order: 50,
});

export const settings = [
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-integrations.mcpEnabled",
    group: "instance-integrations",
    label: "MCP server",
    description:
      "Lets an AI agent such as Claude Code connect over MCP, signed in as a member. The server reads it as it starts, so a change applies after the next restart. It stays off while BETTER_AUTH_URL is not HTTPS or MCP_DISABLED=1.",
    keywords: ["mcp", "ai", "agent", "claude", "oauth", "tools"],
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    audience: "admin",
    restartRequired: true,
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-integrations.mcpToolGroups",
    group: "instance-integrations",
    label: "Agent tools",
    description:
      "The tools an agent may be offered: reading the catalogue, and changing it.",
    keywords: ["mcp", "ai", "agent", "tools", "scopes", "permissions"],
    schema: z.array(z.enum(MCP_SCOPES)),
    default: [...MCP_SCOPES],
    control: {
      kind: "multiselect",
      options: MCP_SCOPES.map((value) => ({
        value,
        label: MCP_SCOPE_LABELS[value],
      })),
    },
    audience: "admin",
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-integrations.mcpAccessTokenHours",
    group: "instance-integrations",
    label: "Agent access tokens last",
    description:
      "How long an AI agent's access token lasts before it refreshes or signs in again. The server reads it as it starts, so a change applies to tokens issued after the next restart.",
    keywords: [
      "mcp",
      "ai",
      "agent",
      "token",
      "access",
      "expiry",
      "lifetime",
      "oauth",
    ],
    schema: wholeNumber(1, 720),
    default: 24,
    control: { kind: "duration", unit: "h", min: 1, max: 720 },
    audience: "admin",
    restartRequired: true,
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-integrations.mcpRefreshTokenDays",
    group: "instance-integrations",
    label: "Agent refresh tokens last",
    description:
      "How long an AI agent stays connected without asking you to sign in again, when granted stay-connected access. The server reads it as it starts, so a change applies to tokens issued after the next restart.",
    keywords: [
      "mcp",
      "ai",
      "agent",
      "token",
      "refresh",
      "offline",
      "expiry",
      "lifetime",
      "oauth",
    ],
    schema: wholeNumber(1, 365),
    default: 90,
    control: { kind: "duration", unit: "d", min: 1, max: 365 },
    audience: "admin",
    restartRequired: true,
  }),
  defineSetting({
    ...INSTANCE_ONLY,
    key: "instance-integrations.logLevel",
    group: "instance-integrations",
    label: "Log level",
    description:
      "The least severe line the server writes to its log. LOG_LEVEL gives it until it is set here.",
    keywords: ["logs", "logging", "debug", "verbosity"],
    schema: z.enum(LOG_LEVELS),
    default: "info",
    control: {
      kind: "select",
      options: LOG_LEVELS.map((value) => ({
        value,
        label: LOG_LEVEL_LABELS[value],
      })),
    },
    audience: "admin",
  }),
];
