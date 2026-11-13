/**
 * Initials for an avatar: the first letters of the first two words ("Ana Petrović" → "AP").
 * A member without a name is labelled by their email; its local part gives the initials
 * ("ana.petrovic@x.com" → "AP", "alex@x.com" → "AL"), so they don't collapse to one letter
 * that matches half the team (CD-363, TC9). A label with " · email" after the name uses the name.
 */
export const initialsOf = (name: string | undefined): string => {
  const label = String(name || '').split(' · ')[0]!.trim();
  const at = label.indexOf('@');
  if (at > 0 && !label.includes(' ')) {
    const parts = label.slice(0, at).split(/[._\-+]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
    return (parts[0] ?? label).slice(0, 2).toUpperCase();
  }
  return label
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
};
