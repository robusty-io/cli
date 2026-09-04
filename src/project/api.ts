import type { Config } from "../config";
import { ApiError, CliError } from "../errors";
import type { ErrorResponseContext } from "../http";
import { apiRequest } from "../http";
import { apiErrorResponseSchema, cliProjectsResponseSchema } from "../schemas";
import type { CliProjectSummary } from "../schemas";

export type { CliProjectSummary } from "../schemas";

function mapProjectsError({ status, json }: ErrorResponseContext): ApiError {
  const result = apiErrorResponseSchema.safeParse(json);
  const code = result.success ? result.data.error : undefined;

  return new ApiError(
    status === 401
      ? "Your saved login is no longer valid. Run robusty login again."
      : `Could not list Robusty projects (HTTP ${status}).`,
    status,
    code,
  );
}

export async function fetchProjects(
  config: Config,
  token: string,
): Promise<CliProjectSummary[]> {
  const body = await apiRequest<unknown>(config.webUrl, "/api/cli/projects", {
    token,
    mapError: mapProjectsError,
  });

  const result = cliProjectsResponseSchema.safeParse(body);

  if (!result.success) {
    throw new CliError("Robusty returned an invalid project list.");
  }

  return result.data.projects;
}
