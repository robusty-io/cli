import {
  mkdir,
  readFile,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { CliError } from "../errors";
import type { CliProjectSummary } from "./api";
import { cliProjectSummarySchema, projectLinkSchema } from "../schemas";
import type { ProjectLink } from "../schemas";

export type { ProjectLink } from "../schemas";

async function atomicWrite(path: string, contents: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;

  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporaryPath, contents, "utf8");
  await rename(temporaryPath, path);
}

export async function writeProjectLink(
  directory: string,
  project: CliProjectSummary,
): Promise<ProjectLink> {
  if (!cliProjectSummarySchema.safeParse(project).success) {
    throw new CliError("Cannot link an invalid Robusty project.");
  }

  const link: ProjectLink = {
    projectId: project.uid,
    projectName: project.name,
  };

  await atomicWrite(
    join(directory, ".robusty", "project.json"),
    `${JSON.stringify(link, null, 2)}\n`,
  );
  return link;
}

export async function resolveProjectLink(
  directory: string,
): Promise<ProjectLink | undefined> {
  const path = join(directory, ".robusty", "project.json");

  try {
    const result = projectLinkSchema.safeParse(
      JSON.parse(await readFile(path, "utf8")),
    );

    if (!result.success) {
      throw new CliError(
        `Invalid project link at ${path}. Run robusty link again.`,
      );
    }

    return result.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      if (error instanceof CliError) throw error;
      throw new CliError(
        `Invalid project link at ${path}. Run robusty link again.`,
      );
    }
  }

  return directory === parse(directory).root
    ? undefined
    : resolveProjectLink(dirname(directory));
}

export async function deleteProjectLink(directory: string): Promise<boolean> {
  const robustyDirectory = join(directory, ".robusty");
  const path = join(robustyDirectory, "project.json");

  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;

    return directory === parse(directory).root
      ? false
      : deleteProjectLink(dirname(directory));
  }

  await rmdir(robustyDirectory).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error;
  });

  return true;
}
