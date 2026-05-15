export type ThreadRow = {
  id: string;
  rollout_path: string | null;
  created_at: number | null;
  updated_at: number | null;
  cwd: string | null;
  title: string | null;
  preview: string | null;
  first_user_message: string | null;
  git_sha: string | null;
  git_branch: string | null;
  git_origin_url: string | null;
  archived: number | null;
};

export type GlobalState = Record<string, unknown>;

export type TranscriptMetadata = {
  filePath: string;
  threadId: string | null;
  cwdMentions: string[];
  userMessages: string[];
  eventMessages: string[];
};

export type CodexPaths = {
  codexHome: string;
  stateDbPath: string;
  globalStatePath: string;
  sessionsDir: string;
};

export type LoadedCodexData = {
  paths: CodexPaths;
  threads: ThreadRow[];
  globalState: GlobalState;
  savedProjectRoots: string[];
  transcripts: TranscriptMetadata[];
  transcriptsByThreadId: Map<string, TranscriptMetadata>;
  transcriptIds: Set<string>;
};

export type ProjectMatchReason =
  | "exact-cwd"
  | "descendant-cwd"
  | "transcript-cwd"
  | "git-origin";

export type ProjectMatch = {
  matches: boolean;
  reasons: ProjectMatchReason[];
};

export type PreviewSource = "first_user_message" | "transcript_user_message" | "transcript_event_message";

export type PreviewRecovery = {
  value: string;
  source: PreviewSource;
};

export type RepairAction =
  | {
      type: "fill-preview";
      threadId: string;
      value: string;
      source: PreviewSource;
    }
  | {
      type: "fill-title";
      threadId: string;
      value: string;
      source: "preview";
    }
  | {
      type: "set-workspace-root-hint";
      threadId: string;
      value: string;
      source: "saved-project-root";
    }
  | {
      type: "remap-cwd";
      threadId: string;
      from: string;
      to: string;
      source: "saved-project-root";
    };

export type RepairPlan = {
  actions: RepairAction[];
  unappliedOptionalActions: RepairAction[];
};
