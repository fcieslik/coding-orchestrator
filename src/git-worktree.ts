import { execFile } from "node:child_process";
import { lstat, mkdir, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";

import {
  FlowError,
  inspectRun,
  mutateRun,
  type ReadRunResult,
} from "./workflow-run.js";
import { gitStateSchema, type StateSnapshot } from "./schema.js";

const git = promisify(execFile);

export interface PrepareWorktreeOptions {
  repository?: string;
  runId: string;
  base?: string;
  branch?: string;
  worktree?: string;
}

export interface PreparedWorktree {
  snapshot: StateSnapshot;
  run: ReadRunResult;
  warnings?: string[];
}

interface TargetRepository {
  path: string;
  commonDirectory: string;
  objectFormat: string;
}

interface WorktreeRegistration {
  path: string;
  branch?: string;
}

async function runGit(
  repository: string,
  args: string[],
  missingCode = "GIT_RESOURCE_NOT_FOUND",
): Promise<string> {
  try {
    const result = await git("git", args, {
      cwd: repository,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return result.stdout.trim();
  } catch (error) {
    const details = error && typeof error === "object" ? error : undefined;
    const stderr =
      details && "stderr" in details && typeof details.stderr === "string"
        ? details.stderr.trim()
        : "Git command failed";
    throw new FlowError(stderr || "Git command failed", 3, missingCode, {
      repository,
      command: ["git", ...args],
    });
  }
}

async function resolveCommit(
  repository: string,
  revision: string,
  objectFormat?: string,
): Promise<string> {
  const commit = await runGit(repository, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${revision}^{commit}`,
  ]);
  if (!/^[0-9a-f]+$/.test(commit))
    throw new FlowError(
      `Git did not return a canonical commit identifier for ${revision}`,
      4,
      "GIT_INVARIANT_VIOLATION",
      { revision, commit },
    );
  if (
    (objectFormat === "sha1" && commit.length !== 40) ||
    (objectFormat === "sha256" && commit.length !== 64)
  )
    throw new FlowError(
      `Git returned an invalid ${objectFormat ?? "unknown"} commit identifier`,
      4,
      "GIT_INVARIANT_VIOLATION",
      { revision, objectFormat, commit },
    );
  return commit;
}

function invariant(
  message: string,
  details?: Record<string, unknown>,
): FlowError {
  return new FlowError(message, 4, "GIT_INVARIANT_VIOLATION", details);
}

async function canonicalGitPath(
  repository: string,
  path: string,
): Promise<string> {
  const absolute = resolve(repository, path);
  try {
    return await realpath(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return absolute;
    throw error;
  }
}

async function resolveTargetRepository(
  repositoryPath = process.cwd(),
): Promise<TargetRepository> {
  const startingPath = resolve(repositoryPath);
  let bare: string;
  try {
    bare = await runGit(startingPath, ["rev-parse", "--is-bare-repository"]);
  } catch {
    throw new FlowError(
      `Target repository is not a Git checkout: ${repositoryPath}`,
      3,
      "INVALID_REPOSITORY",
      { repository: repositoryPath },
    );
  }
  if (bare === "true")
    throw new FlowError(
      `Target repository is bare: ${repositoryPath}`,
      4,
      "BARE_REPOSITORY",
      { repository: repositoryPath },
    );

  let root: string;
  try {
    root = await realpath(
      await runGit(startingPath, ["rev-parse", "--show-toplevel"]),
    );
  } catch {
    throw new FlowError(
      `Target repository is not a Git checkout: ${repositoryPath}`,
      3,
      "INVALID_REPOSITORY",
      { repository: repositoryPath },
    );
  }
  const superproject = await runGit(root, [
    "rev-parse",
    "--show-superproject-working-tree",
  ]);
  if (superproject.length > 0)
    throw invariant("A Git submodule checkout cannot be a Target repository", {
      repository: root,
      superproject,
    });
  const objectFormat = await runGit(root, [
    "rev-parse",
    "--show-object-format=storage",
  ]);
  if (objectFormat !== "sha1" && objectFormat !== "sha256")
    throw invariant(`Unsupported Git object format: ${objectFormat}`, {
      repository: root,
      objectFormat,
    });
  try {
    await resolveCommit(root, "HEAD", objectFormat);
  } catch (error) {
    if (
      error instanceof FlowError &&
      error.exitCode === 3 &&
      (await isUnbornRepository(root))
    )
      throw new FlowError(
        "Target repository has no commit (an unborn repository is not supported)",
        4,
        "UNBORN_REPOSITORY",
        { repository: root },
      );
    throw error;
  }
  const commonDirectory = await canonicalGitPath(
    root,
    await runGit(root, ["rev-parse", "--git-common-dir"]),
  );
  return { path: root, commonDirectory, objectFormat };
}

async function isUnbornRepository(repository: string): Promise<boolean> {
  let headReference: string;
  try {
    headReference = await runGit(repository, [
      "symbolic-ref",
      "--quiet",
      "HEAD",
    ]);
  } catch {
    return false;
  }
  try {
    await runGit(repository, [
      "show-ref",
      "--verify",
      "--quiet",
      headReference,
    ]);
    return false;
  } catch {
    return true;
  }
}

async function defaultWorktreePath(
  repository: string,
  runId: string,
): Promise<string> {
  return resolve(
    dirname(repository),
    `.${basename(repository)}-worktrees`,
    runId,
  );
}

function isWithin(path: string, parent: string): boolean {
  const relation = relative(parent, path);
  return (
    relation === "" ||
    (relation !== ".." &&
      !relation.startsWith(`..${sep}`) &&
      !isAbsolute(relation))
  );
}

async function assertDestinationSafe(
  repository: string,
  destination: string,
  registrations: WorktreeRegistration[],
): Promise<void> {
  if (isWithin(destination, repository)) {
    throw new FlowError(
      `Feature worktree must be outside the Target repository: ${destination}`,
      4,
      "WORKTREE_PATH_INVALID",
    );
  }
  const protectedWorktree = registrations.find((registration) =>
    isWithin(destination, registration.path),
  );
  if (protectedWorktree) {
    throw new FlowError(
      `Feature worktree must be outside registered Git worktree: ${protectedWorktree.path}`,
      4,
      "WORKTREE_PATH_INVALID",
      { protectedPath: protectedWorktree.path },
    );
  }
  let current = destination;
  const components: string[] = [];
  while (current !== dirname(current)) {
    components.unshift(current);
    current = dirname(current);
  }
  components.unshift(current);
  for (const component of components) {
    try {
      if ((await lstat(component)).isSymbolicLink()) {
        throw new FlowError(
          `Feature worktree path traverses a symbolic link: ${component}`,
          4,
          "WORKTREE_PATH_INVALID",
        );
      }
    } catch (error) {
      if (error instanceof FlowError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
  try {
    await lstat(destination);
    throw new FlowError(
      `Feature worktree destination already exists: ${destination}`,
      3,
      "WORKTREE_ALREADY_EXISTS",
    );
  } catch (error) {
    if (error instanceof FlowError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function listWorktrees(
  repository: string,
): Promise<WorktreeRegistration[]> {
  const output = await runGit(repository, ["worktree", "list", "--porcelain"]);
  return Promise.all(
    output
      .split(/\r?\n\r?\n/)
      .filter((entry) => entry.length > 0)
      .map(async (entry) => {
        const lines = entry.split(/\r?\n/);
        const path = lines
          .find((line) => line.startsWith("worktree "))
          ?.slice("worktree ".length);
        if (!path) throw invariant("Git returned a worktree without a path");
        const branchLine = lines.find((line) => line.startsWith("branch "));
        return {
          path: await canonicalGitPath(repository, path),
          ...(branchLine === undefined
            ? {}
            : {
                branch: branchLine
                  .slice("branch ".length)
                  .replace(/^refs\/heads\//, ""),
              }),
        };
      }),
  );
}

async function validatePreparedWorktree(
  repository: string,
  state: StateSnapshot,
): Promise<void> {
  const gitState = gitStateSchema.parse(state.git);
  await assertNoSymlinkComponents(gitState.featureWorktree);
  const targetCommonDirectory = await canonicalGitPath(
    repository,
    await runGit(repository, ["rev-parse", "--git-common-dir"]),
  );
  const worktreeCommonDirectory = await canonicalGitPath(
    gitState.featureWorktree,
    await runGit(gitState.featureWorktree, ["rev-parse", "--git-common-dir"]),
  );
  if (targetCommonDirectory !== worktreeCommonDirectory)
    throw invariant("Feature worktree belongs to a different Git repository", {
      expectedCommonDirectory: targetCommonDirectory,
      actualCommonDirectory: worktreeCommonDirectory,
    });
  const objectFormat = await runGit(repository, [
    "rev-parse",
    "--show-object-format=storage",
  ]);
  const head = await resolveCommit(
    gitState.featureWorktree,
    "HEAD",
    objectFormat,
  );
  const branch = await runGit(gitState.featureWorktree, [
    "symbolic-ref",
    "--short",
    "HEAD",
  ]);
  if (branch !== gitState.featureBranch || head !== gitState.runBase) {
    throw new FlowError(
      "Feature worktree does not match the planned Run base and branch",
      4,
      "WORKTREE_INVARIANT_VIOLATION",
      {
        expectedBranch: gitState.featureBranch,
        expectedHead: gitState.runBase,
        branch,
        head,
      },
    );
  }
  const status = await runGit(gitState.featureWorktree, [
    "status",
    "--porcelain",
  ]);
  if (status.length > 0) {
    throw new FlowError("Feature worktree is not clean", 4, "DIRTY_WORKTREE", {
      status,
    });
  }
  const registrations = await listWorktrees(repository);
  if (
    !registrations.some(
      (entry) => entry.path === resolve(gitState.featureWorktree),
    )
  ) {
    throw new FlowError(
      "Feature worktree is not registered at the planned path",
      4,
      "WORKTREE_INVARIANT_VIOLATION",
      { expectedPath: gitState.featureWorktree },
    );
  }
}

async function assertNoSymlinkComponents(path: string): Promise<void> {
  const absolute = resolve(path);
  const components = absolute.split(sep).filter(Boolean);
  let current = absolute.startsWith(sep) ? sep : "";
  for (const component of components) {
    current = resolve(current, component);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new FlowError(
          `Feature worktree path traverses a symbolic link: ${current}`,
          4,
          "WORKTREE_PATH_INVALID",
        );
    } catch (error) {
      if (error instanceof FlowError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

async function targetWarnings(
  repository: string,
): Promise<string[] | undefined> {
  const status = await runGit(repository, ["status", "--porcelain"]);
  return status.length === 0
    ? undefined
    : [
        "Target repository has uncommitted changes; they are excluded from the Run base.",
      ];
}

export async function prepareWorktree(
  options: PrepareWorktreeOptions,
): Promise<PreparedWorktree> {
  const target = await resolveTargetRepository(options.repository);
  const canonicalRepository = target.path;
  const current = await inspectRun(canonicalRepository, options.runId);
  if (current.snapshot.git?.worktreeStatus === "ready") {
    if (options.base && options.base !== current.snapshot.git.runBase)
      throw new FlowError(
        "Run base conflicts with persisted Git intent",
        2,
        "GIT_INTENT_CONFLICT",
      );
    if (options.branch && options.branch !== current.snapshot.git.featureBranch)
      throw new FlowError(
        "Feature branch conflicts with persisted Git intent",
        2,
        "GIT_INTENT_CONFLICT",
      );
    if (
      options.worktree &&
      resolve(options.worktree) !== current.snapshot.git.featureWorktree
    )
      throw new FlowError(
        "Feature worktree conflicts with persisted Git intent",
        2,
        "GIT_INTENT_CONFLICT",
      );
    await validatePreparedWorktree(canonicalRepository, current.snapshot);
    const warnings = await targetWarnings(canonicalRepository);
    return {
      snapshot: current.snapshot,
      run: current,
      ...(warnings === undefined ? {} : { warnings }),
    };
  }
  if (current.snapshot.phase !== "created") {
    throw new FlowError(
      "Workflow run is not ready for worktree preparation",
      4,
      "INVALID_PREPARATION_STATE",
    );
  }
  const runBase = await resolveCommit(
    canonicalRepository,
    options.base ?? "HEAD",
    target.objectFormat,
  );
  const featureBranch = options.branch ?? `orchestrator/${options.runId}`;
  const featureWorktree = resolve(
    options.worktree ??
      (await defaultWorktreePath(canonicalRepository, options.runId)),
  );
  if (
    featureBranch.startsWith("-") ||
    !(await runGit(canonicalRepository, [
      "check-ref-format",
      "--branch",
      featureBranch,
    ])
      .then(() => true)
      .catch(() => false))
  ) {
    throw new FlowError(
      `Invalid Feature branch: ${featureBranch}`,
      2,
      "INVALID_FEATURE_BRANCH",
    );
  }
  const registrations = await listWorktrees(canonicalRepository);
  await assertDestinationSafe(
    canonicalRepository,
    featureWorktree,
    registrations,
  );
  const checkedOut = registrations.find(
    (registration) => registration.branch === featureBranch,
  );
  if (checkedOut) {
    throw new FlowError(
      `Feature branch is already checked out: ${featureBranch}`,
      3,
      "FEATURE_BRANCH_CHECKED_OUT",
      { featureBranch, worktree: checkedOut.path },
    );
  }
  try {
    await runGit(canonicalRepository, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${featureBranch}`,
    ]);
    throw new FlowError(
      `Feature branch already exists: ${featureBranch}`,
      3,
      "FEATURE_BRANCH_ALREADY_EXISTS",
    );
  } catch (error) {
    if (
      !(error instanceof FlowError) ||
      error.code !== "GIT_RESOURCE_NOT_FOUND"
    )
      throw error;
  }

  const planned = await mutateRun({
    repository: canonicalRepository,
    runId: options.runId,
    event: "prepare",
    historyEventType: "git.preparation.started",
    data: {
      runBase,
      featureBranch,
      featureWorktree,
      worktreeStatus: "planned",
    },
    updateSnapshot: (snapshot) => ({
      git: {
        ...(snapshot.git ?? {}),
        schemaVersion: 1,
        runBase,
        featureBranch,
        featureWorktree,
        worktreeStatus: "planned",
      },
    }),
  });
  await mkdir(dirname(featureWorktree), { recursive: true });
  await runGit(
    canonicalRepository,
    [
      "worktree",
      "add",
      "--quiet",
      "-b",
      featureBranch,
      featureWorktree,
      runBase,
    ],
    "WORKTREE_CREATION_FAILED",
  );
  await validatePreparedWorktree(canonicalRepository, planned.snapshot);
  const completed = await mutateRun({
    repository: canonicalRepository,
    runId: options.runId,
    event: "implement",
    historyEventType: "git.worktree.prepared",
    data: {
      runBase,
      featureBranch,
      featureWorktree,
      worktreeStatus: "ready",
      validatedHead: runBase,
    },
    updateSnapshot: (snapshot) => ({
      git: {
        ...(snapshot.git ?? {}),
        schemaVersion: 1,
        runBase,
        featureBranch,
        featureWorktree,
        worktreeStatus: "ready",
        validatedHead: runBase,
      },
    }),
  });
  const warnings = await targetWarnings(canonicalRepository);
  return {
    snapshot: completed.snapshot,
    run: completed,
    ...(warnings === undefined ? {} : { warnings }),
  };
}
