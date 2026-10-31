import type { Line, Session } from "@caprice/core";
import type { Speaker } from "@caprice/voice";

export async function sayAndSpeak(
  session: Session,
  speaker: Speaker,
  hostText: string,
): Promise<Line> {
  const line = await session.say(hostText);
  await speaker.speak(line.text);

  return line;
}
