import type { Line, Session } from "@caprice/core";
import type { Listener, Speaker } from "@caprice/voice";

export async function sayAndSpeak(
  session: Session,
  speaker: Speaker,
  hostText: string,
): Promise<Line> {
  const line = await session.say(hostText);
  await speaker.speak(line.text);

  return line;
}

export async function listenAndSay(
  session: Session,
  listener: Listener,
  speaker: Speaker,
): Promise<Line | undefined> {
  const heard = await listener.listen();
  const text = heard.text.trim();

  if (text.length === 0) {
    return undefined;
  }

  return sayAndSpeak(session, speaker, text);
}
