export type ToolCall = {
  name: string;
  input: string;
};

export type ConfirmKind = "allow" | "refuse" | "talk";

const allowWords = [
  "yes",
  "yeah",
  "yep",
  "ok",
  "okay",
  "confirm",
  "allow",
  "si",
  "sí",
  "oui",
];

const refuseWords = ["no", "nope", "nah", "don't", "dont", "refuse", "non"];

export function readToolCall(text: string): ToolCall | undefined {
  const lines = text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .trim()
    .split("\n");

  const first = lines[0]?.trim() ?? "";

  if (!first.startsWith("call ")) {
    return undefined;
  }

  const after = first.slice("call ".length).trim();
  const space = after.indexOf(" ");
  const name = space < 0 ? after : after.slice(0, space);
  const inline = space < 0 ? "" : after.slice(space + 1).trim();

  if (!isToolName(name)) {
    return undefined;
  }

  const more = lines.slice(1).join("\n").trim();
  let input = inline;

  if (more.length > 0) {
    input = input.length > 0 ? `${input}\n${more}` : more;
  }

  return { name, input };
}

export function confirmKind(text: string): ConfirmKind {
  const word = text.trim().toLowerCase();

  if (listed(allowWords, word)) {
    return "allow";
  }

  if (listed(refuseWords, word)) {
    return "refuse";
  }

  return "talk";
}

export function pendingLabel(call: ToolCall): string {
  const flat = call.input.replaceAll("\n", " ").trim();

  if (flat.length === 0) {
    return call.name;
  }

  const shown = flat.length > 72 ? `${flat.slice(0, 72)}…` : flat;

  return `${call.name} ${shown}`;
}

function isToolName(name: string): boolean {
  if (name.length === 0) {
    return false;
  }

  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    const digit = code >= 48 && code <= 57;
    const lower = code >= 97 && code <= 122;

    if (!digit && !lower && char !== "_") {
      return false;
    }
  }

  return true;
}

function listed(words: readonly string[], word: string): boolean {
  for (const item of words) {
    if (item === word) {
      return true;
    }
  }

  return false;
}
