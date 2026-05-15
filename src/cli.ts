#!/usr/bin/env node
import { Command } from "commander";

import { exportProjectThreads } from "./export.js";
import { repairCodexData, formatRepairResult } from "./repair.js";
import { createScanReport, formatScanReport } from "./scan.js";
import { loadCodexData } from "./storage.js";

const program = new Command();

program
  .name("codex-relink")
  .description("Inspect and conservatively repair Codex chat-to-project links.")
  .version("1.0.0")
  .option("--codex-home <path>", "Codex home directory", "~/.codex");

program
  .command("scan")
  .description("Read Codex storage and report link health. Read-only.")
  .option("--project <path>", "Focus on one project root")
  .option("--json", "Print JSON")
  .action(async (options: { project?: string; json?: boolean }) => {
    const data = await loadCodexData({ codexHome: program.opts<{ codexHome: string }>().codexHome });
    const report = createScanReport(data, { project: options.project });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      process.stdout.write(formatScanReport(report, options.project));
    }
  });

program
  .command("repair")
  .description("Plan or apply conservative Codex metadata repairs.")
  .option("--project <path>", "Focus on one project root")
  .option("--dry-run", "Do not write anything")
  .option("--backup", "Create backups and apply conservative repairs")
  .option("--fix-hints", "Also add/update thread-workspace-root-hints")
  .option("--fix-cwd", "Also remap nested cwd values to saved project roots")
  .option("--json", "Print JSON")
  .action(
    async (options: {
      project?: string;
      dryRun?: boolean;
      backup?: boolean;
      fixHints?: boolean;
      fixCwd?: boolean;
      json?: boolean;
    }) => {
      const data = await loadCodexData({ codexHome: program.opts<{ codexHome: string }>().codexHome });
      const result = await repairCodexData(data, {
        project: options.project,
        dryRun: options.dryRun || !options.backup,
        backup: options.backup,
        fixHints: options.fixHints,
        fixCwd: options.fixCwd
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        process.stdout.write(formatRepairResult(result));
      }
    }
  );

program
  .command("export")
  .description("Export project matching threads to JSON. Read-only.")
  .requiredOption("--project <path>", "Project root")
  .option("--output <path>", "Output JSON path")
  .action(async (options: { project: string; output?: string }) => {
    const data = await loadCodexData({ codexHome: program.opts<{ codexHome: string }>().codexHome });
    const outputPath = exportProjectThreads(data, {
      project: options.project,
      output: options.output
    });
    console.log(`Wrote ${outputPath}`);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
