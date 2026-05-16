import { Separator } from "@inquirer/prompts";
import { describe, expect, it } from "vitest";

import {
  createInteractiveRepairChoices,
  formatRepairChoiceDescription,
  formatRepairChoiceName,
  getSelectedRepairActions
} from "./interactive.js";
import type { RepairAction, RepairPlan } from "./types.js";

describe("interactive repair helpers", () => {
  it("groups recommended and optional repair choices with expected defaults", () => {
    const plan: RepairPlan = {
      actions: [
        fillGenericPreviewAction,
        fillGenericTitleAction,
        setHintAction,
        remapCwdAction
      ],
      unappliedOptionalActions: []
    };

    const group = createInteractiveRepairChoices(plan);
    const separators = group.choices.filter((choice) => Separator.isSeparator(choice));
    const choices = group.choices.filter((choice) => !Separator.isSeparator(choice));

    expect(separators.map((separator) => separator.separator)).toEqual([
      "Recommended repairs",
      "Optional project-link repairs"
    ]);
    expect(choices.map((choice) => choice.checked)).toEqual([true, true, false, false]);
  });

  it("formats compact rows with short ids and truncated previews", () => {
    const action: RepairAction = {
      type: "fill-generic-preview",
      threadId: "019abcdef1234567890",
      value: "Recovered Codex conversation",
      source: "desktop-visibility"
    };

    const label = formatRepairChoiceName(action);

    expect(label).toContain("fill-generic-preview 019abcde preview:");
    expect(label.length).toBeLessThan(120);
  });

  it("formats descriptions with longer details", () => {
    expect(formatRepairChoiceDescription(remapCwdAction)).toBe(
      "Change cwd for 019abcdef1234567890 from /repo/app/packages/web to /repo/app"
    );
  });

  it("maps selected checkbox values back to selected actions only", () => {
  const plan: RepairPlan = {
      actions: [fillGenericPreviewAction, setHintAction],
      unappliedOptionalActions: []
    };
    const group = createInteractiveRepairChoices(plan);
    const selectedValue = group.choices.find((choice) => !Separator.isSeparator(choice) && choice.name.startsWith("set-workspace-root-hint"));

    if (!selectedValue || Separator.isSeparator(selectedValue)) {
      throw new Error("Expected set-workspace-root-hint choice");
    }

    const selectedActions = getSelectedRepairActions(
      [selectedValue.value, "missing-value"],
      group.actionByValue
    );

    expect(selectedActions).toEqual([setHintAction]);
  });
});

const fillGenericPreviewAction: RepairAction = {
  type: "fill-generic-preview",
  threadId: "019abcdef1234567890",
  value: "Recovered Codex conversation",
  source: "desktop-visibility"
};

const fillGenericTitleAction: RepairAction = {
  type: "fill-generic-title",
  threadId: "019abcdef1234567890",
  value: "Recovered title #1",
  source: "desktop-visibility"
};

const setHintAction: RepairAction = {
  type: "set-workspace-root-hint",
  threadId: "019abcdef1234567890",
  value: "/repo/app",
  source: "saved-project-root"
};

const remapCwdAction: RepairAction = {
  type: "remap-cwd",
  threadId: "019abcdef1234567890",
  from: "/repo/app/packages/web",
  to: "/repo/app",
  source: "saved-project-root"
};
