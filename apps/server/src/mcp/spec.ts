import { z, type ZodType } from "zod";
import type { Actor, Scope } from "./actor.js";

/**
 * A tool the registry can register: its gating scope and Zod input/output,
 * typed at the call site that builds it. `defineTool` widens this to
 * `AnyToolSpec` for storage in a module's array alongside every other tool.
 */
export type ToolSpec<
  I extends ZodType = ZodType,
  O extends ZodType = ZodType,
> = {
  name: string;
  title: string;
  description: string;
  scope: Scope;
  /** Marks the tool as destructive, so the client confirms with the user before calling it. */
  destructive?: boolean;
  /** Repeating the call with the same input leaves the same state. */
  idempotent?: boolean;
  input: I;
  output: O;
  run: (actor: Actor, input: z.infer<I>) => Promise<z.infer<O>>;
};

/** A `ToolSpec` as stored in a module's array, its input/output types erased for uniform storage. */
export type AnyToolSpec = ToolSpec;

/**
 * Types a tool spec at its definition site — `input`, `output` and `run` are
 * checked against each other before the spec widens to `AnyToolSpec` for
 * storage in a module's array alongside every other tool.
 */
export function defineTool<I extends ZodType, O extends ZodType>(
  spec: ToolSpec<I, O>
): AnyToolSpec {
  return spec as AnyToolSpec;
}

/** A resource the registry can register: a URI (template) and the read it shares with a tool. */
export type ResourceSpec = {
  /** A URI, e.g. `projammr://projects`, or a template, e.g. `projammr://projects/{projectId}`. */
  template: string;
  name: string;
  title: string;
  description: string;
  mimeType: "text/markdown" | "application/json";
  read: (actor: Actor, params: Record<string, string>) => Promise<string>;
};

/** Types a resource spec at its definition site; a resource module exports an array of these. */
export function defineResource(spec: ResourceSpec): ResourceSpec {
  return spec;
}
