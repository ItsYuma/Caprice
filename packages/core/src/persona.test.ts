import { expect, test } from "bun:test";

import { contractText, personaText } from "./persona.ts";

const skill = await Bun.file(
  new URL("../../../skills/capri/SKILL.md", import.meta.url),
).text();

const host = await Bun.file(
  new URL("../../../skills/host/SKILL.md", import.meta.url),
).text();

test("capri skill feeds the model from the voice heading", () => {
  const persona = personaText(skill);

  expect(persona.startsWith("## Voice")).toBe(true);
  expect(persona).toContain("bored");
  expect(persona).toContain("cheerful");
  expect(persona).toContain("mock");
  expect(persona).toContain("fun");
});

test("host skill states the confirmation rule", () => {
  const contract = contractText(host);

  expect(contract.startsWith("## Contract")).toBe(true);
  expect(contract).toContain("confirm");
  expect(contract).toContain("league_live");
  expect(contract).toContain("league_lcu");
  expect(contract).toContain("/liveclientdata/allgamedata");
  expect(contract).toContain("/lol-matchmaking/v1/ready-check/accept");
  expect(contract).toContain("champion-summary.json");
});

test("personaText rejects a skill with no voice", () => {
  expect(() => personaText("# Capri\nnope")).toThrow("Voice");
});

test("contractText rejects a skill with no contract", () => {
  expect(() => contractText("# Host\nnope")).toThrow("Contract");
});
