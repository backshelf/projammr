import { z } from "zod";

// Kept apart from the `session_samples` table so the session wire schemas can
// import the sample shape without importing `sessions` back.

export const SAMPLE_KINDS = ["project", "outside", "library"] as const;
export const SAMPLE_STATUSES = ["present", "missing", "unknown"] as const;

/** The most samples one session's create or edit body may carry. */
export const MAX_SAMPLES = 500;

/** The wire shape of one sample. */
export const sessionSampleSchema = z.object({
  path: z.string(),
  kind: z.enum(SAMPLE_KINDS),
  status: z.enum(SAMPLE_STATUSES),
});

export type SessionSample = z.infer<typeof sessionSampleSchema>;
export type SampleKind = (typeof SAMPLE_KINDS)[number];
export type SampleStatus = (typeof SAMPLE_STATUSES)[number];

/**
 * One sample a save references, as dit reports it. `relative` is the path under
 * the project folder, present only for a `project` reference under `Samples/`;
 * `object` and `size` are null until dit has read the file. A reference is
 * never a foreign key to `objects`: "not pushed" is an object the hub lacks.
 */
export const sampleRefSchema = z.object({
  path: z.string(),
  kind: z.enum(SAMPLE_KINDS),
  relative: z.string().optional(),
  object: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  size: z.number().int().nonnegative().nullable(),
});

export type SampleRef = z.infer<typeof sampleRefSchema>;
