import path from "node:path";

import { normalizeFsPath } from "./paths.js";
import type { ProjectMatch, ThreadRow, TranscriptMetadata } from "./types.js";

export function isSameOrDescendantPath(candidateInput: string, rootInput: string): "exact" | "descendant" | null {
  const candidate = normalizeFsPath(candidateInput);
  const root = normalizeFsPath(rootInput);

  if (candidate === root) {
    return "exact";
  }

  const relative = path.relative(root, candidate);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return "descendant";
  }

  return null;
}

export function matchThreadToProject(
  thread: ThreadRow,
  projectRootInput: string,
  transcript?: TranscriptMetadata | null
): ProjectMatch {
  const reasons: ProjectMatch["reasons"] = [];
  const projectRoot = normalizeFsPath(projectRootInput);

  if (thread.cwd) {
    const cwdMatch = isSameOrDescendantPath(thread.cwd, projectRoot);
    if (cwdMatch === "exact") {
      reasons.push("exact-cwd");
    } else if (cwdMatch === "descendant") {
      reasons.push("descendant-cwd");
    }
  }

  if (transcript?.cwdMentions.some((cwd) => isSameOrDescendantPath(cwd, projectRoot) != null)) {
    reasons.push("transcript-cwd");
  }

  const projectBase = path.basename(projectRoot).toLowerCase();
  if (thread.git_origin_url?.toLowerCase().includes(projectBase)) {
    reasons.push("git-origin");
  }

  return {
    matches: reasons.length > 0,
    reasons
  };
}

export function findContainingSavedRoot(cwdInput: string | null | undefined, savedProjectRoots: string[]): string | null {
  if (!cwdInput) {
    return null;
  }

  const matches = savedProjectRoots
    .map((root) => ({ root: normalizeFsPath(root), kind: isSameOrDescendantPath(cwdInput, root) }))
    .filter((match): match is { root: string; kind: "exact" | "descendant" } => match.kind != null)
    .sort((left, right) => right.root.length - left.root.length);

  return matches[0]?.root ?? null;
}

export function looksSuspiciousCwd(cwd: string | null | undefined, savedProjectRoots: string[]): string[] {
  const flags: string[] = [];
  if (!cwd || cwd.trim() === "") {
    return ["blank-cwd"];
  }

  const normalized = normalizeFsPath(cwd);
  const segments = normalized.split(path.sep).filter(Boolean);

  if (normalized.startsWith("/private/tmp") || normalized.startsWith("/tmp")) {
    flags.push("temporary-folder");
  }

  if (segments.some((segment) => ["node_modules", "dist", "build", ".next", ".turbo", ".cache", "coverage"].includes(segment))) {
    flags.push("generated-folder");
  }

  if (segments.some((segment) => ["references", "reference", "tmp", "temp"].includes(segment.toLowerCase()))) {
    flags.push("likely-nested-working-folder");
  }

  const containingRoot = findContainingSavedRoot(normalized, savedProjectRoots);
  if (containingRoot && normalizeFsPath(containingRoot) !== normalized) {
    flags.push("nested-under-saved-root");
  }

  return flags;
}
