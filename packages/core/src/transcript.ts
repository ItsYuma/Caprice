export type UserEvent = {
  kind: "user";
  text: string;
};

export type AssistantEvent = {
  kind: "assistant";
  text: string;
};

export type ToolCallEvent = {
  kind: "tool-call";
  id: string;
  name: string;
  input: string;
};

export type ToolResultEvent = {
  kind: "tool-result";
  id: string;
  name: string;
  ok: boolean;
  text: string;
};

export type TranscriptEvent =
  UserEvent | AssistantEvent | ToolCallEvent | ToolResultEvent;

export const threadLimit = 20;

export const threadSizeLimit = 24_000;

export const toolResultLimit = 8_000;

export const transcriptSizeLimit = 64_000;

const truncated = "\n[truncated]";

export function clipText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  if (limit <= truncated.length) {
    return truncated.slice(0, limit);
  }

  return `${text.slice(0, limit - truncated.length)}${truncated}`;
}

export function conversationEvents(
  events: readonly TranscriptEvent[],
): TranscriptEvent[] {
  const kept: TranscriptEvent[] = [];

  for (const event of events) {
    if (event.kind === "user" || event.kind === "assistant") {
      kept.push({
        kind: event.kind,
        text: clipText(event.text, threadSizeLimit),
      });
    }
  }

  trimOldest(kept, threadLimit, threadSizeLimit);

  return kept;
}

export function trimTranscript(events: TranscriptEvent[]): void {
  boundPayloads(events);

  while (overTranscript(events)) {
    if (!dropOldestUnit(events)) {
      break;
    }
  }
}

export function eventSize(event: TranscriptEvent): number {
  if (event.kind === "tool-call") {
    return event.id.length + event.name.length + event.input.length;
  }

  if (event.kind === "tool-result") {
    return event.id.length + event.name.length + event.text.length;
  }

  return event.text.length;
}

function boundPayloads(events: TranscriptEvent[]): void {
  for (const event of events) {
    if (event.kind === "tool-call") {
      event.input = clipText(event.input, toolResultLimit);

      continue;
    }

    if (event.kind === "tool-result") {
      event.text = clipText(event.text, toolResultLimit);

      continue;
    }

    event.text = clipText(event.text, threadSizeLimit);
  }
}

function dropOldestUnit(events: TranscriptEvent[]): boolean {
  const boundary = secondUser(events);

  if (boundary > 0) {
    events.splice(0, boundary);

    return true;
  }

  return dropOldestTool(events);
}

function secondUser(events: readonly TranscriptEvent[]): number {
  let seen = 0;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];

    if (event !== undefined && event.kind === "user") {
      seen += 1;

      if (seen === 2) {
        return index;
      }
    }
  }

  return -1;
}

function dropOldestTool(events: TranscriptEvent[]): boolean {
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];

    if (event === undefined) {
      continue;
    }

    if (event.kind === "tool-call") {
      const resultAt = resultIndex(events, event.id, index + 1);

      if (resultAt >= 0) {
        events.splice(resultAt, 1);
        events.splice(index, 1);

        return true;
      }

      events.splice(index, 1);

      return true;
    }

    if (event.kind === "tool-result") {
      events.splice(index, 1);

      return true;
    }
  }

  return false;
}

function resultIndex(
  events: readonly TranscriptEvent[],
  id: string,
  from: number,
): number {
  for (let index = from; index < events.length; index += 1) {
    const event = events[index];

    if (
      event !== undefined &&
      event.kind === "tool-result" &&
      event.id === id
    ) {
      return index;
    }
  }

  return -1;
}

function trimOldest(
  events: TranscriptEvent[],
  limit: number,
  sizeLimit: number,
): void {
  while (
    events.length > 1 &&
    (events.length > limit || transcriptSize(events) > sizeLimit)
  ) {
    events.splice(0, 1);
  }
}

function overTranscript(events: readonly TranscriptEvent[]): boolean {
  return (
    events.length > threadLimit || transcriptSize(events) > transcriptSizeLimit
  );
}

function transcriptSize(events: readonly TranscriptEvent[]): number {
  let size = 0;

  for (const event of events) {
    size += eventSize(event);
  }

  return size;
}
