import type { Result } from "./result.ts";

export type ToolKind = "read" | "action";

export type ToolSpec = {
  name: string;
  description: string;
  kind: ToolKind;
};

export type ToolContext = {
  request: string;
  signal: AbortSignal;
};

export type Tool = ToolSpec & {
  parse: (input: string) => Result<string>;
  run: (input: string, context: ToolContext) => Promise<string>;
};

export function toolGuide(tools: readonly ToolSpec[]): string {
  if (tools.length === 0) {
    return "";
  }

  const lines = ["## Tools"];

  for (const tool of tools) {
    lines.push("", `${tool.name} (${tool.kind})`, tool.description);
  }

  return lines.join("\n");
}

export function toolSpecs(tools: readonly Tool[]): ToolSpec[] {
  const specs: ToolSpec[] = [];

  for (const tool of tools) {
    specs.push({
      name: tool.name,
      description: tool.description,
      kind: tool.kind,
    });
  }

  return specs;
}
