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
  slug: nonBlankString,
});

export type LaunchStartResponse = z.infer<typeof launchStartResponseSchema>;

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
