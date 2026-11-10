export function personaText(skill: string): string {
  return section(skill, "## Voice", "capri skill is missing Voice");
}

export function contractText(skill: string): string {
  return section(skill, "## Contract", "host skill is missing Contract");
}

export function playText(skill: string): string {
  return section(skill, "## Play", "skill is missing Play");
}

function section(skill: string, heading: string, missing: string): string {
  const start = skill.indexOf(heading);

  if (start < 0) {
    throw new Error(missing);
  }

  return skill.slice(start).trim();
}
