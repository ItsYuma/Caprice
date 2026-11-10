export type ToolCall = {
  name: string;
  input: string;
};

export type TextReply =
  | { kind: "prose"; text: string }
  | { kind: "call"; name: string; input: string };

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

export function interpretTextReply(
  text: string,
  offered: readonly string[],
): TextReply {
  const call = readToolCall(text);

  if (call === undefined) {
    return { kind: "prose", text };
  }

  if (hasName(offered, call.name) || call.name.includes("_")) {
    return { kind: "call", name: call.name, input: call.input };
  }

  return { kind: "prose", text };
}

function hasName(offered: readonly string[], name: string): boolean {
  for (const tool of offered) {
    if (tool === name) {
      return true;
    }
  }

  return false;
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
