import { z } from "zod";

import { fail, ok, type Result } from "./result.ts";

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

export type DefinedTool<Value> = {
  name: string;
  description: string;
  kind: ToolKind;
  schema: z.ZodType<Value>;
  run: (value: Value, context: ToolContext) => Promise<string>;
};

export function defineTool<Value>(defined: DefinedTool<Value>): Tool {
  return {
    name: defined.name,
    description: defined.description,
    kind: defined.kind,
    parse(input) {
      return canonical(defined.schema, input);
    },
    async run(input, context) {
      const parsed = defined.schema.safeParse(JSON.parse(input));

      if (!parsed.success) {
        throw new Error("the tool input is not valid");
      }

      return defined.run(parsed.data, context);
    },
  };
}

function canonical<Value>(
  schema: z.ZodType<Value>,
  input: string,
): Result<string> {
  try {
    const parsed = schema.safeParse(JSON.parse(input));

    if (!parsed.success) {
      return fail("the tool input is not valid");
    }

    return ok(JSON.stringify(parsed.data));
  } catch {
    return fail("the tool input is not valid");
  }
}

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
