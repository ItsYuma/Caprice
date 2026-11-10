import { modelDeadlineMs, ok, type ModelEnv, type Tool } from "@caprice/core";
import { expect, test } from "bun:test";

import { openCaprice, type CapriceDeps, type Integration } from "./compose.ts";
import { leagueIntegration } from "./league/league.ts";

const env: ModelEnv = {
  CAPRICE_MODEL_URL: undefined,
  CAPRICE_MODEL: undefined,
  CAPRICE_MODEL_API_KEY: undefined,
  CAPRICE_MODEL_PROTOCOL: undefined,
};

test("a missing model is a configuration failure", async () => {
  const opened = await openCaprice(deps());

  expect(opened).toEqual({
    status: "misconfigured",
    message: "CAPRICE_MODEL_URL is required",
  });
});

test("the shell posts the body and does not receive a key", async () => {
  const bodies: string[] = [];
  let deadline: number | undefined;

  const opened = await openCaprice(
    deps({
      inShell: true,
      readShell: async () => ({ model: "shell-model", protocol: "text" }),
      postShell: async (body, _signal, deadlineMs) => {
        bodies.push(body);
        deadline = deadlineMs;

        return ok(
          JSON.stringify({
            choices: [{ message: { content: "yo" } }],
          }),
        );
      },
      integrations: [
        leagueIntegration("## Play\nPick Yasuo when they ask.", {
          async live() {
            return "stats";
          },
          async lcu() {
            return "phase";
          },
        }),
        extraIntegration,
      ],
    }),
  );

  expect(opened.status).toBe("ready");

  if (opened.status !== "ready") {
    return;
  }

  const line = await opened.session.say("hi");
  const body = JSON.parse(bodies[0] ?? "{}");

  expect(line).toEqual({
    ok: true,
    value: { kind: "assistant", text: "yo" },
  });
  expect(body.model).toBe("shell-model");
  expect(body.tools).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain("secret");
  expect(deadline).toBe(modelDeadlineMs);
  expect(body.messages[0].content).toContain("## Play");
  expect(body.messages[0].content).toContain("## Extra");
  expect(body.messages[0].content).toContain("/liveclientdata/allgamedata");
  expect(body.messages[0].content).toContain("league_lcu (action)");
  expect(body.messages[0].content).toContain("map_look (read)");
});

test("a shell timeout replaces the browser default", async () => {
  let deadline: number | undefined;

  const opened = await openCaprice(
    deps({
      inShell: true,
      readShell: async () => ({
        model: "shell-model",
        protocol: "text",
        timeoutMs: 1_500,
      }),
      postShell: async (_body, _signal, deadlineMs) => {
        deadline = deadlineMs;

        return ok(
          JSON.stringify({
            choices: [{ message: { content: "yo" } }],
          }),
        );
      },
    }),
  );

  expect(opened.status).toBe("ready");

  if (opened.status !== "ready") {
    return;
  }

  await opened.session.say("hi");
  expect(deadline).toBe(1_500);
});

function deps(patch: Partial<CapriceDeps> = {}): CapriceDeps {
  return {
    voiceSkill: "## Voice\nbe capri",
    hostSkill: "## Contract\ncall <name> <input>",
    env,
    inShell: false,
    async readShell() {
      throw new Error("shell was read");
    },
    async postShell() {
      throw new Error("shell posted");
    },
    async postBrowser() {
      throw new Error("browser posted");
    },
    remembered: [],
    integrations: [],
    ...patch,
  };
}

const mapTool: Tool = {
  name: "map_look",
  description: "Look at the map.",
  kind: "read",
  parse(input) {
    return ok(input);
  },
  async run() {
    return "clear";
  },
};

const extraIntegration: Integration = {
  instructions: "## Extra\nLook at the map.",
  tools: [mapTool],
};
