import { expect, test } from "bun:test";

import { contractText, personaText, playText } from "./persona.ts";

const skill = await Bun.file(
  new URL("../../../skills/capri/SKILL.md", import.meta.url),
).text();

const host = await Bun.file(
  new URL("../../../skills/host/SKILL.md", import.meta.url),
).text();

const league = await Bun.file(
  new URL("../../../skills/league/SKILL.md", import.meta.url),
).text();

test("capri skill feeds the model from the voice heading", () => {
  const persona = personaText(skill);

  expect(persona.startsWith("## Voice")).toBe(true);
  expect(persona).toContain("bored");
  expect(persona).toContain("cheerful");
  expect(persona).toContain("mock");
  expect(persona).toContain("fun");
});

test("host skill tells her how to call a tool", () => {
  const contract = contractText(host);

  expect(contract.startsWith("## Contract")).toBe(true);
  expect(contract).toContain("four calls");
  expect(contract).toContain("call <name> <input>");
  expect(contract).toContain("Do not ask them to confirm");
  expect(contract).not.toContain("league_live");
  expect(contract).not.toContain("/liveclientdata/allgamedata");
});

test("league skill tells her the request is enough", () => {
  const play = playText(league);

  expect(play.startsWith("## Play")).toBe(true);
  expect(play).toContain("Pick Yasuo");
  expect(play).toContain("Do not ask them to confirm");
  expect(play).toContain("champion-summary.json");
});

test("personaText rejects a skill with no voice", () => {
  expect(() => personaText("# Capri\nnope")).toThrow("Voice");
});

test("contractText rejects a skill with no contract", () => {
  expect(() => contractText("# Host\nnope")).toThrow("Contract");
});

test("playText rejects a skill with no play section", () => {
  expect(() => playText("# League\nnope")).toThrow("Play");
});
