import { execFile } from "node:child_process";
import { access, lstat, mkdir } from "node:fs/promises";
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

async function runGit(
  repository: string,
  args: string[],
  missingCode = "GIT_RESOURCE_NOT_FOUND",
): Promise<string> {
  try {
    const result = await git("git", ["-C", repository, ...args], {
      encoding: "utf8",
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
): Promise<string> {
  return runGit(repository, ["rev-parse", "--verify", `${revision}^{commit}`]);
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
): Promise<void> {
  if (isWithin(destination, repository)) {
    throw new FlowError(
      `Feature worktree must be outside the Target repository: ${destination}`,
      4,
      "WORKTREE_PATH_INVALID",
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
    await access(destination);
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

async function validatePreparedWorktree(
  repository: string,
  state: StateSnapshot,
): Promise<void> {
  const gitState = gitStateSchema.parse(state.git);
  const head = await resolveCommit(gitState.featureWorktree, "HEAD");
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
  const commonDirectory = await runGit(repository, [
    "rev-parse",
    "--git-common-dir",
  ]);
  const worktreeCommonDirectory = await runGit(gitState.featureWorktree, [
    "rev-parse",
    "--git-common-dir",
  ]);
  if (
    resolve(repository, commonDirectory) !==
    resolve(gitState.featureWorktree, worktreeCommonDirectory)
  ) {
    throw new FlowError(
      "Feature worktree belongs to a different Git repository",
      4,
      "WORKTREE_INVARIANT_VIOLATION",
    );
  }
  const registrations = await runGit(repository, [
    "worktree",
    "list",
    "--porcelain",
  ]);
  const registeredPath = registrations
    .split(/\r?\n(?=worktree )/)
    .map((entry) => entry.split(/\r?\n/)[0]?.slice("worktree ".length))
    .find(
      (entry) =>
        entry !== undefined &&
        resolve(entry) === resolve(gitState.featureWorktree),
    );
  if (!registeredPath) {
    throw new FlowError(
      "Feature worktree is not registered at the planned path",
      4,
      "WORKTREE_INVARIANT_VIOLATION",
      { expectedPath: gitState.featureWorktree },
    );
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
  const canonicalRepository = resolve(
    await runGit(options.repository ?? process.cwd(), [
      "rev-parse",
      "--show-toplevel",
    ]),
  );
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
  );
  const featureBranch = options.branch ?? `orchestrator/${options.runId}`;
  const featureWorktree = resolve(
    options.worktree ??
      (await defaultWorktreePath(canonicalRepository, options.runId)),
  );
  if (
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
  await assertDestinationSafe(canonicalRepository, featureWorktree);
  try {
    await runGit(canonicalRepository, [
      "show-ref",
      "--verify",
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
