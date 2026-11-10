import type { Tool } from "@caprice/core";

export type Integration = {
  instructions: string;
  tools: readonly Tool[];
};
