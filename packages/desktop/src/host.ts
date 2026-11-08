import { tryCatch, type Line, type Result, type Session } from "@caprice/core";
import type { Speaker } from "@caprice/voice";

export async function sayAndSpeak(
  session: Session,
  speaker: Speaker,
  hostText: string,
): Promise<Result<Line>> {
  const line = await session.say(hostText);

  if (!line.ok) {
    return line;
  }

  const spoken = await tryCatch(
    speaker.speak(line.value.text),
    "the model request failed",
  );

  if (!spoken.ok) {
    return spoken;
  }

  return line;
}
