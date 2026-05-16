#!/usr/bin/env node
import { Command } from "commander";

import {
  findResumeCandidates,
  formatNoChatsFound,
  getLatestResumeCandidate,
  isPromptExit,
  selectResumeCandidate
} from "./resume.js";
import { loadCodexData } from "./storage.js";

const program = new Command();

program
  .name("codex-relink")
  .description("Find Codex chats for the current directory and print resume commands.")
  .version("1.0.0")
  .option("--codex-home <path>", "Codex home directory", "~/.codex");

program
  .command("latest")
  .description("Print the newest Codex resume command for the current directory.")
  .action(async () => {
    const cwd = process.cwd();
    const data = await loadCodexData({ codexHome: program.opts<{ codexHome: string }>().codexHome });
    const latest = getLatestResumeCandidate(findResumeCandidates(data, cwd));
    if (!latest) {
      console.log(formatNoChatsFound(cwd));
      return;
    }

    console.log(latest.resumeCommand);
  });

program
  .command("list")
  .description("Pick a Codex chat for the current directory and print its resume command.")
  .action(async () => {
    const cwd = process.cwd();
    const data = await loadCodexData({ codexHome: program.opts<{ codexHome: string }>().codexHome });
    const candidates = findResumeCandidates(data, cwd);
    if (candidates.length === 0) {
      console.log(formatNoChatsFound(cwd));
      return;
    }

    const selected = await selectResumeCandidate(candidates);
    console.log(selected.resumeCommand);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  if (isPromptExit(error)) {
    console.error("Interactive selection cancelled.");
    process.exitCode = 130;
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
