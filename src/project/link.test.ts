import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError } from "../errors";
import {
  deleteProjectLink,
  resolveProjectLink,
  writeProjectLink,
} from "./link";

const project = { uid: "project-1", name: "Main Project" };

describe("project links", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "robusty-project-link-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("writes replaceable non-secret project metadata", async () => {
    await writeProjectLink(directory, project);
    await writeProjectLink(directory, {
      uid: "project-2",
      name: "Replacement",
    });

    const contents = await readFile(
      join(directory, ".robusty", "project.json"),
      "utf8",
    );
    expect(JSON.parse(contents)).toEqual({
      projectId: "project-2",
      projectName: "Replacement",
    });
    expect(contents.endsWith("\n")).toBe(true);
    expect(contents).not.toContain("token");
  });

  it("resolves the nearest link while walking through parent directories", async () => {
    const nested = join(directory, "packages", "app");
    const child = join(nested, "src", "features");
    await mkdir(child, { recursive: true });
    await writeProjectLink(directory, project);
    await writeProjectLink(nested, {
      uid: "project-nearest",
      name: "Nearest",
    });

    await expect(resolveProjectLink(child)).resolves.toMatchObject({
      projectId: "project-nearest",
      projectName: "Nearest",
    });
  });

  it("returns undefined when no current or parent link exists", async () => {
    const nested = join(directory, "one", "two");
    await mkdir(nested, { recursive: true });

    await expect(resolveProjectLink(nested)).resolves.toBeUndefined();
  });

  it("ignores legacy environment fields left in an existing link", async () => {
    const path = join(directory, ".robusty", "project.json");
    await mkdir(join(directory, ".robusty"));
    await writeFile(
      path,
      JSON.stringify({
        projectId: "project-1",
        projectName: "Main Project",
        webUrl: "https://www.robusty.io",
        launcherUrl: "https://launcher.robusty.io",
      }),
      "utf8",
    );

    await expect(resolveProjectLink(directory)).resolves.toEqual({
      projectId: "project-1",
      projectName: "Main Project",
    });
  });

  it.each([
    ["malformed JSON", "{not-json"],
    [
      "incomplete metadata",
      JSON.stringify({
        projectId: "project-1",
      }),
    ],
  ])("rejects %s with a relinking instruction", async (_name, contents) => {
    const path = join(directory, ".robusty", "project.json");
    await mkdir(join(directory, ".robusty"));
    await writeFile(path, contents, "utf8");

    await expect(resolveProjectLink(directory)).rejects.toThrow(CliError);
    await expect(resolveProjectLink(directory)).rejects.toThrow(
      `Invalid project link at ${path}. Run robusty link again.`,
    );
  });

  it("deletes the nearest project link and empty metadata directory", async () => {
    const nested = join(directory, "packages", "app");
    const child = join(nested, "src");
    await mkdir(child, { recursive: true });
    await writeProjectLink(directory, project);
    await writeProjectLink(nested, {
      uid: "project-nearest",
      name: "Nearest",
    });

    await expect(deleteProjectLink(child)).resolves.toBe(true);
    await expect(resolveProjectLink(child)).resolves.toMatchObject({
      projectId: project.uid,
    });
    await expect(
      readFile(join(nested, ".robusty", "project.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does nothing when no project link exists", async () => {
    const nested = join(directory, "one", "two");
    await mkdir(nested, { recursive: true });

    await expect(deleteProjectLink(nested)).resolves.toBe(false);
  });
});
