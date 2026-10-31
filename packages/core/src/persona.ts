const voiceHeading = "## Voice";

export function personaText(skill: string): string {
  const start = skill.indexOf(voiceHeading);

  if (start < 0) {
    throw new Error("capri skill is missing Voice");
  }

  return skill.slice(start).trim();
}
