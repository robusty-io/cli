import type { Config } from "./config";
import { ApiError, CliError } from "./errors";
import { apiErrorResponseSchema, cliProjectsResponseSchema } from "./schemas";
import type { CliProjectSummary } from "./schemas";

export type { CliProjectSummary } from "./schemas";

export async function fetchProjects(
  config: Config,
  token: string,
  request: typeof fetch = fetch,
): Promise<CliProjectSummary[]> {
  let response: Response;
  try {
    response = await request(`${config.webUrl}/api/cli/projects`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  } catch {
    throw new CliError(
      `Could not reach ${config.webUrl}. Check your network connection.`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  if (!response.ok) {
    const errorResponse = apiErrorResponseSchema.safeParse(body);
    const code = errorResponse.success ? errorResponse.data.error : undefined;

    throw new ApiError(
      response.status === 401
        ? "Your saved login is no longer valid. Run robusty login again."
        : `Could not list Robusty projects (HTTP ${response.status}).`,
      response.status,
      code,
    );
  }

  const result = cliProjectsResponseSchema.safeParse(body);

  if (!result.success) {
    throw new CliError("Robusty returned an invalid project list.");
  }

  return result.data.projects;
}
