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
  acquireGitOperationLock,
  acquireRunLock,
  FlowError,
  inspectRun,
  mutateRun,
  releaseGitOperationLock,
  releaseRunLock,
  type RunDependencies,
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
  dependencies?: PrepareWorktreeDependencies;
}

export type GitCommandRunner = (
  repository: string,
  args: string[],
  missingCode?: string,
) => Promise<string>;

export interface PrepareWorktreeDependencies extends RunDependencies {
  /** Test seam for forcing deterministic Git failures after intent publication. */
  gitRunner?: GitCommandRunner;
}

export interface PreparedWorktree {
  snapshot: StateSnapshot;
  run: ReadRunResult;
  warnings?: string[];
}

export interface ValidateWorktreeOptions {
  repository?: string;
  runId: string;
}

export interface WorktreeValidationCheck {
  valid: boolean;
  expected?: unknown;
  actual?: unknown;
  reason?: string;
}

export interface WorktreeValidationReport {
  repository: string;
  runId: string;
  git: NonNullable<StateSnapshot["git"]>;
  valid: boolean;
  checks: {
    repository: WorktreeValidationCheck;
    registration: WorktreeValidationCheck;
    path: WorktreeValidationCheck;
    branch: WorktreeValidationCheck;
    head: WorktreeValidationCheck;
    cleanliness: WorktreeValidationCheck;
  };
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

function validationFailure(
  report: WorktreeValidationReport,
  message: string,
  code: string,
  exitCode = 4,
): FlowError {
  const failedChecks = Object.entries(report.checks)
    .filter(([, check]) => !check.valid)
    .map(([name]) => name);
  return new FlowError(
    `${message}: ${failedChecks.join(", ")}`,
    exitCode,
    code,
    { ...report, failedChecks },
  );
}

function checkFailure(
  reason: string,
  expected?: unknown,
  actual?: unknown,
): WorktreeValidationCheck {
  return {
    valid: false,
    reason,
    ...(expected === undefined ? {} : { expected }),
    ...(actual === undefined ? {} : { actual }),
  };
}

function checkSuccess(
  expected?: unknown,
  actual?: unknown,
): WorktreeValidationCheck {
  return {
    valid: true,
    ...(expected === undefined ? {} : { expected }),
    ...(actual === undefined ? {} : { actual }),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Git state could not be inspected";
}

/** Prove the persisted Feature worktree baseline without locks or mutations. */
export async function validateWorktree(
  options: ValidateWorktreeOptions,
): Promise<WorktreeValidationReport> {
  const target = await resolveTargetRepository(options.repository);
  const current = await inspectRun(target.path, options.runId);
  if (!current.audit.synchronized)
    throw new FlowError(
      `Workflow run ${options.runId} has an unresolved history audit gap`,
      4,
      "AUDIT_GAP",
      { runId: options.runId, warning: current.audit.warning },
    );
  const persisted = gitStateSchema.safeParse(current.snapshot.git);
  if (!persisted.success || persisted.data.worktreeStatus !== "ready")
    throw new FlowError(
      `Workflow run ${options.runId} does not have a ready Feature worktree`,
      4,
      "WORKTREE_NOT_READY",
      { runId: options.runId },
    );
  if (!persisted.data.validatedHead)
    throw new FlowError(
      `Workflow run ${options.runId} has no validated Feature worktree HEAD`,
      4,
      "WORKTREE_NOT_READY",
      { runId: options.runId },
    );

  const gitState = persisted.data;
  const expectedPath = resolve(gitState.featureWorktree);
  const checks = {
    repository: checkSuccess(target.commonDirectory),
    registration: checkFailure("not checked"),
    path: checkFailure("not checked"),
    branch: checkFailure("not checked"),
    head: checkFailure("not checked"),
    cleanliness: checkFailure("not checked"),
  };
  let pathExists = false;
  let pathFailure: FlowError | undefined;

  try {
    await assertNoSymlinkComponents(expectedPath);
    const entry = await lstat(expectedPath);
    if (!entry.isDirectory()) {
      checks.path = checkFailure(
        "Feature worktree path is not a directory",
        expectedPath,
      );
      pathFailure = new FlowError(
        `Feature worktree path is not a directory: ${expectedPath}`,
        4,
        "WORKTREE_PATH_INVALID",
      );
    } else {
      pathExists = true;
      const canonicalPath = await realpath(expectedPath);
      checks.path =
        canonicalPath === expectedPath
          ? checkSuccess(expectedPath, canonicalPath)
          : checkFailure(
              "Feature worktree path is not canonical",
              expectedPath,
              canonicalPath,
            );
    }
  } catch (error) {
    pathFailure =
      error instanceof FlowError
        ? error
        : (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new FlowError(
              `Feature worktree was not found: ${expectedPath}`,
              3,
              "FEATURE_WORKTREE_NOT_FOUND",
            )
          : undefined;
    checks.path = checkFailure(
      pathFailure?.code === "FEATURE_WORKTREE_NOT_FOUND"
        ? "Feature worktree is missing"
        : errorMessage(error),
      expectedPath,
    );
  }

  try {
    const registrations = await listWorktrees(target.path);
    const registration = registrations.find(
      (entry) => entry.path === expectedPath,
    );
    checks.registration = registration
      ? checkSuccess(expectedPath, {
          path: registration.path,
          ...(registration.branch === undefined
            ? {}
            : { branch: registration.branch }),
        })
      : checkFailure(
          "Feature worktree is not registered at the persisted path",
          expectedPath,
          registrations.map((entry) => entry.path),
        );
  } catch (error) {
    checks.registration = checkFailure(
      "Git worktree registrations could not be inspected",
      errorMessage(error),
    );
  }
  const registrationFailure = checks.registration.valid
    ? undefined
    : new FlowError(
        `Feature worktree registration was not found: ${expectedPath}`,
        3,
        "WORKTREE_REGISTRATION_NOT_FOUND",
      );

  let actualHead: string | undefined;
  let actualBranch: string | undefined;
  let actualBranchRef: string | undefined;
  if (pathExists) {
    try {
      const actualCommonDirectory = await canonicalGitPath(
        expectedPath,
        await runGit(expectedPath, ["rev-parse", "--git-common-dir"]),
      );
      checks.repository =
        actualCommonDirectory === target.commonDirectory
          ? checkSuccess(target.commonDirectory, actualCommonDirectory)
          : checkFailure(
              "Feature worktree belongs to a different Git repository",
              target.commonDirectory,
              actualCommonDirectory,
            );
    } catch (error) {
      checks.repository = checkFailure(
        "Feature worktree is not a Git checkout",
        target.commonDirectory,
        errorMessage(error),
      );
    }

    try {
      actualBranch = await runGit(expectedPath, [
        "symbolic-ref",
        "--quiet",
        "--short",
        "HEAD",
      ]);
    } catch {
      actualBranch = undefined;
    }
    try {
      actualHead = await resolveCommit(
        expectedPath,
        "HEAD",
        target.objectFormat,
      );
    } catch {
      actualHead = undefined;
    }
    try {
      actualBranchRef = await resolveCommit(
        target.path,
        `refs/heads/${gitState.featureBranch}`,
        target.objectFormat,
      );
    } catch {
      actualBranchRef = undefined;
    }
    checks.branch =
      actualBranch === gitState.featureBranch &&
      actualBranchRef === gitState.validatedHead
        ? checkSuccess(
            { name: gitState.featureBranch, ref: gitState.validatedHead },
            { name: actualBranch, ref: actualBranchRef },
          )
        : checkFailure(
            actualBranch === undefined
              ? "Feature worktree HEAD is detached"
              : actualBranchRef === undefined
                ? "Feature branch is missing"
                : "Feature branch does not match the persisted baseline",
            { name: gitState.featureBranch, ref: gitState.validatedHead },
            { name: actualBranch, ref: actualBranchRef },
          );
    checks.head =
      actualHead === gitState.validatedHead
        ? checkSuccess(gitState.validatedHead, actualHead)
        : checkFailure(
            actualHead === undefined
              ? "Feature worktree HEAD could not be resolved"
              : "Feature worktree HEAD does not match the persisted baseline",
            gitState.validatedHead,
            actualHead,
          );
    try {
      const status = await runGit(expectedPath, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ]);
      const lines = status.length === 0 ? [] : status.split(/\r?\n/);
      const untracked = lines.filter((line) => line.startsWith("?? "));
      const tracked = lines.filter((line) => !line.startsWith("?? "));
      checks.cleanliness =
        lines.length === 0
          ? checkSuccess("clean", "clean")
          : checkFailure(
              untracked.length > 0 && tracked.length > 0
                ? "Feature worktree has tracked changes and non-ignored untracked files"
                : untracked.length > 0
                  ? "Feature worktree has non-ignored untracked files"
                  : "Feature worktree has tracked changes",
              "clean",
              { tracked, untracked },
            );
    } catch (error) {
      checks.cleanliness = checkFailure(
        "Feature worktree cleanliness could not be inspected",
        "clean",
        errorMessage(error),
      );
    }
  } else {
    checks.repository = checkFailure(
      "Feature worktree is missing",
      target.commonDirectory,
    );
    checks.branch = checkFailure("Feature worktree is missing", {
      name: gitState.featureBranch,
      ref: gitState.validatedHead,
    });
    checks.head = checkFailure(
      "Feature worktree is missing",
      gitState.validatedHead,
    );
    checks.cleanliness = checkFailure("Feature worktree is missing", "clean");
  }

  const report: WorktreeValidationReport = {
    repository: target.path,
    runId: options.runId,
    git: gitState,
    valid: Object.values(checks).every((check) => check.valid),
    checks,
  };
  if (report.valid) return report;
  if (pathFailure)
    throw validationFailure(
      report,
      pathFailure.message,
      pathFailure.code,
      pathFailure.exitCode,
    );
  if (registrationFailure)
    throw validationFailure(
      report,
      registrationFailure.message,
      registrationFailure.code,
      registrationFailure.exitCode,
    );
  if (!checks.repository.valid)
    throw validationFailure(
      report,
      "Feature worktree repository identity does not match the Target repository",
      "GIT_INVARIANT_VIOLATION",
    );
  if (!checks.branch.valid && actualBranchRef === undefined)
    throw validationFailure(
      report,
      `Feature branch was not found: ${gitState.featureBranch}`,
      "FEATURE_BRANCH_NOT_FOUND",
      3,
    );
  if (!checks.cleanliness.valid) {
    const actual = checks.cleanliness.actual;
    const hasUntracked =
      typeof actual === "object" &&
      actual !== null &&
      "untracked" in actual &&
      Array.isArray(actual.untracked) &&
      actual.untracked.length > 0;
    throw validationFailure(
      report,
      "Feature worktree is not clean",
      hasUntracked ? "UNTRACKED_WORKTREE" : "DIRTY_WORKTREE",
    );
  }
  throw validationFailure(
    report,
    "Feature worktree baseline does not match persisted Git facts",
    "WORKTREE_INVARIANT_VIOLATION",
  );
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

function intentConflict(
  field: string,
  expected: string,
  actual: string,
): FlowError {
  return new FlowError(
    `${field} conflicts with persisted Git intent (expected ${expected}, received ${actual})`,
    2,
    "GIT_INTENT_CONFLICT",
    { field, expected, actual },
  );
}

async function branchExists(
  repository: string,
  branch: string,
): Promise<boolean> {
  try {
    await runGit(repository, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ]);
    return true;
  } catch (error) {
    if (error instanceof FlowError && error.code === "GIT_RESOURCE_NOT_FOUND")
      return false;
    throw error;
  }
}

async function validateBranchName(
  repository: string,
  branch: string,
): Promise<void> {
  if (
    branch.startsWith("-") ||
    !(await runGit(repository, ["check-ref-format", "--branch", branch])
      .then(() => true)
      .catch(() => false))
  ) {
    throw new FlowError(
      `Invalid Feature branch: ${branch}`,
      2,
      "INVALID_FEATURE_BRANCH",
    );
  }
}

async function pathComponentsAreSafe(path: string): Promise<void> {
  const absolute = resolve(path);
  let current = absolute;
  const components: string[] = [];
  while (current !== dirname(current)) {
    components.unshift(current);
    current = dirname(current);
  }
  components.unshift(current);
  for (const component of components) {
    try {
      if ((await lstat(component)).isSymbolicLink())
        throw new FlowError(
          `Feature worktree path traverses a symbolic link: ${component}`,
          4,
          "WORKTREE_PATH_INVALID",
        );
    } catch (error) {
      if (error instanceof FlowError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
}

async function inspectPlannedResources(
  repository: string,
  target: TargetRepository,
  state: StateSnapshot,
): Promise<"ready" | "missing"> {
  const gitState = gitStateSchema.parse(state.git);
  const registrations = await listWorktrees(repository);
  const expectedPath = resolve(gitState.featureWorktree);
  const expected = registrations.find(
    (registration) => registration.path === expectedPath,
  );
  const branchRegistration = registrations.find(
    (registration) => registration.branch === gitState.featureBranch,
  );

  if (expected) {
    if (expected.branch !== gitState.featureBranch) {
      throw invariant(
        "A registered Feature worktree uses a different branch than the persisted plan",
        {
          expectedBranch: gitState.featureBranch,
          actualBranch: expected.branch,
        },
      );
    }
    await validatePreparedWorktree(repository, state);
    return "ready";
  }
  if (branchRegistration) {
    throw new FlowError(
      `Feature branch is already checked out: ${gitState.featureBranch}`,
      3,
      "FEATURE_BRANCH_CHECKED_OUT",
      {
        featureBranch: gitState.featureBranch,
        worktree: branchRegistration.path,
      },
    );
  }

  await pathComponentsAreSafe(expectedPath);
  try {
    await lstat(expectedPath);
    throw new FlowError(
      `Feature worktree destination already exists: ${expectedPath}`,
      3,
      "WORKTREE_ALREADY_EXISTS",
    );
  } catch (error) {
    if (error instanceof FlowError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  if (await branchExists(repository, gitState.featureBranch)) {
    const head = await resolveCommit(
      repository,
      gitState.featureBranch,
      target.objectFormat,
    );
    if (head !== gitState.runBase) {
      throw invariant(
        "Persisted Feature branch does not point to the planned Run base",
        { expectedHead: gitState.runBase, actualHead: head },
      );
    }
  }
  return "missing";
}

async function createPlannedResources(
  repository: string,
  target: TargetRepository,
  state: StateSnapshot,
  gitRunner: GitCommandRunner = runGit,
): Promise<void> {
  const gitState = gitStateSchema.parse(state.git);
  const expectedPath = resolve(gitState.featureWorktree);
  await mkdir(dirname(expectedPath), { recursive: true });
  const exists = await branchExists(repository, gitState.featureBranch);
  await gitRunner(
    repository,
    exists
      ? ["worktree", "add", "--quiet", expectedPath, gitState.featureBranch]
      : [
          "worktree",
          "add",
          "--quiet",
          "-b",
          gitState.featureBranch,
          expectedPath,
          gitState.runBase,
        ],
    "WORKTREE_CREATION_FAILED",
  );
}

async function resolvePersistedIntent(
  repository: string,
  target: TargetRepository,
  current: ReadRunResult,
  options: PrepareWorktreeOptions,
): Promise<{
  runBase: string;
  featureBranch: string;
  featureWorktree: string;
}> {
  const persisted = gitStateSchema.safeParse(current.snapshot.git);
  if (persisted.success) {
    if (
      current.snapshot.phase !== "preparing" ||
      persisted.data.worktreeStatus !== "planned"
    )
      throw invariant(
        "Persisted planned Git intent has an incompatible Run phase",
      );
    const gitState = persisted.data;
    if (options.base !== undefined) {
      const resolved = await resolveCommit(
        repository,
        options.base,
        target.objectFormat,
      );
      if (resolved !== gitState.runBase)
        throw intentConflict("Run base", gitState.runBase, resolved);
    }
    if (
      options.branch !== undefined &&
      options.branch !== gitState.featureBranch
    )
      throw intentConflict(
        "Feature branch",
        gitState.featureBranch,
        options.branch,
      );
    if (options.worktree !== undefined) {
      const resolved = resolve(options.worktree);
      if (resolved !== gitState.featureWorktree)
        throw intentConflict(
          "Feature worktree",
          gitState.featureWorktree,
          resolved,
        );
    }
    return {
      runBase: gitState.runBase,
      featureBranch: gitState.featureBranch,
      featureWorktree: gitState.featureWorktree,
    };
  }
  if (current.snapshot.git !== undefined)
    throw invariant("Persisted Git intent is invalid");
  if (current.snapshot.phase !== "created")
    throw new FlowError(
      "Workflow run is not ready for worktree preparation",
      4,
      "INVALID_PREPARATION_STATE",
    );
  const runBase = await resolveCommit(
    repository,
    options.base ?? "HEAD",
    target.objectFormat,
  );
  const featureBranch = options.branch ?? `orchestrator/${options.runId}`;
  const featureWorktree = resolve(
    options.worktree ?? (await defaultWorktreePath(repository, options.runId)),
  );
  await validateBranchName(repository, featureBranch);
  const registrations = await listWorktrees(repository);
  await assertDestinationSafe(repository, featureWorktree, registrations);
  const checkedOut = registrations.find(
    (registration) => registration.branch === featureBranch,
  );
  if (checkedOut)
    throw new FlowError(
      `Feature branch is already checked out: ${featureBranch}`,
      3,
      "FEATURE_BRANCH_CHECKED_OUT",
      { featureBranch, worktree: checkedOut.path },
    );
  if (await branchExists(repository, featureBranch))
    throw new FlowError(
      `Feature branch already exists: ${featureBranch}`,
      3,
      "FEATURE_BRANCH_ALREADY_EXISTS",
    );
  return { runBase, featureBranch, featureWorktree };
}

export async function prepareWorktree(
  options: PrepareWorktreeOptions,
  dependencies: PrepareWorktreeDependencies = options.dependencies ?? {},
): Promise<PreparedWorktree> {
  const target = await resolveTargetRepository(options.repository);
  const canonicalRepository = target.path;
  const gitLock = await acquireGitOperationLock(
    canonicalRepository,
    dependencies,
  );
  try {
    const runLock = await acquireRunLock(
      canonicalRepository,
      options.runId,
      dependencies,
    );
    try {
      let current = await inspectRun(canonicalRepository, options.runId);
      if (!current.audit.synchronized)
        throw new FlowError(
          `Workflow run ${options.runId} has an unresolved history audit gap`,
          4,
          "AUDIT_GAP",
          { runId: options.runId, warning: current.audit.warning },
        );
      const persisted = gitStateSchema.safeParse(current.snapshot.git);
      if (persisted.success && persisted.data.worktreeStatus === "ready") {
        if (options.base !== undefined) {
          const resolved = await resolveCommit(
            canonicalRepository,
            options.base,
            target.objectFormat,
          );
          if (resolved !== persisted.data.runBase)
            throw intentConflict("Run base", persisted.data.runBase, resolved);
        }
        if (
          options.branch !== undefined &&
          options.branch !== persisted.data.featureBranch
        )
          throw intentConflict(
            "Feature branch",
            persisted.data.featureBranch,
            options.branch,
          );
        if (
          options.worktree !== undefined &&
          resolve(options.worktree) !== persisted.data.featureWorktree
        )
          throw intentConflict(
            "Feature worktree",
            persisted.data.featureWorktree,
            resolve(options.worktree),
          );
        await validatePreparedWorktree(canonicalRepository, current.snapshot);
        const warnings = await targetWarnings(canonicalRepository);
        return {
          snapshot: current.snapshot,
          run: current,
          ...(warnings === undefined ? {} : { warnings }),
        };
      }

      const intent = await resolvePersistedIntent(
        canonicalRepository,
        target,
        current,
        options,
      );
      if (!persisted.success) {
        current = await mutateRun(
          {
            repository: canonicalRepository,
            runId: options.runId,
            event: "prepare",
            historyEventType: "git.preparation.started",
            data: {
              ...intent,
              worktreeStatus: "planned",
            },
            lock: runLock,
            updateSnapshot: (snapshot) => ({
              git: {
                ...(snapshot.git ?? {}),
                schemaVersion: 1,
                ...intent,
                worktreeStatus: "planned",
              },
            }),
          },
          dependencies,
        );
      }

      const state = current.snapshot;
      const resourceStatus = await inspectPlannedResources(
        canonicalRepository,
        target,
        state,
      );
      if (resourceStatus === "missing")
        await createPlannedResources(
          canonicalRepository,
          target,
          state,
          dependencies.gitRunner,
        );
      await validatePreparedWorktree(canonicalRepository, state);
      const completed = await mutateRun(
        {
          repository: canonicalRepository,
          runId: options.runId,
          event: "implement",
          historyEventType: "git.worktree.prepared",
          data: {
            ...intent,
            worktreeStatus: "ready",
            validatedHead: intent.runBase,
          },
          lock: runLock,
          updateSnapshot: (snapshot) => ({
            git: {
              ...(snapshot.git ?? {}),
              schemaVersion: 1,
              ...intent,
              worktreeStatus: "ready",
              validatedHead: intent.runBase,
            },
          }),
        },
        dependencies,
      );
      const warnings = await targetWarnings(canonicalRepository);
      return {
        snapshot: completed.snapshot,
        run: completed,
        ...(warnings === undefined ? {} : { warnings }),
      };
    } finally {
      await releaseRunLock(runLock);
    }
  } finally {
    await releaseGitOperationLock(gitLock);
  }
}
