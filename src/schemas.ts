import { z } from "zod";

const nonBlankString = z.string().refine((value) => value.trim().length > 0);

export const storedCredentialSchema = z.object({
  token: nonBlankString,
  user: z.object({
    id: nonBlankString,
    email: nonBlankString,
  }),
});

export type StoredCredential = z.infer<typeof storedCredentialSchema>;

export const tokenExchangeResponseSchema = storedCredentialSchema.extend({
  token_type: z.literal("Bearer"),
});

export const cliProjectSummarySchema = z.object({
  uid: nonBlankString,
  name: nonBlankString,
});

export type CliProjectSummary = z.infer<typeof cliProjectSummarySchema>;

export const cliProjectsResponseSchema = z.object({
  projects: z.array(cliProjectSummarySchema),
});

export const launchStartResponseSchema = z.object({
  launchId: nonBlankString,
  projectId: nonBlankString,
  slug: nonBlankString,
  total: z.number().int().nonnegative(),
  wsTicket: nonBlankString,
  quota: z
    .object({
      remaining: z.number().optional(),
      limit: z.number().optional(),
    })
    .loose()
    .optional(),
  error: z.string().optional(),
});

export type LaunchStartResponse = z.infer<typeof launchStartResponseSchema>;

export const launchServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("frame"), data: z.string() }),
  z.object({ type: z.literal("url"), url: z.string() }),
  z.object({ type: z.literal("info"), content: z.string() }),
  z.object({ type: z.literal("reasoning"), content: z.string() }),
  z.object({
    type: z.literal("action"),
    content: z.string(),
    screenshot_url: z.string().optional(),
  }),
  z.object({
    type: z.literal("status"),
    status: z.enum(["passed", "failed"]),
    content: z.string(),
  }),
  z.object({ type: z.literal("error"), content: z.string() }),
]);

export type LaunchServerMessage = z.infer<typeof launchServerMessageSchema>;

export const launchServerEnvelopeSchema = z.object({
  testCaseUid: nonBlankString,
  testCaseSlug: nonBlankString,
  logId: z.string().nullable(),
  message: launchServerMessageSchema,
});

export type LaunchServerEnvelope = z.infer<typeof launchServerEnvelopeSchema>;

export const projectLinkSchema = z.object({
  projectId: nonBlankString,
  projectName: nonBlankString,
});

export type ProjectLink = z.infer<typeof projectLinkSchema>;

export const apiErrorResponseSchema = z.object({
  error: z.string().optional(),
  quota: z
    .object({
      remaining: z.number().optional(),
      limit: z.number().optional(),
    })
    .optional(),
});

export const fallbackRecordsSchema = z.record(z.string(), z.string());
