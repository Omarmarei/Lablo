/**
 * The backup code as the screens write it: groups of four from the start (`7ABC DEFG … 12`).
 * Settings › Backup shows the code this way and onboarding's "Restore with a backup code" groups
 * what is typed; it is in main.js for the second (RELAY step 35e: the settings are in settings.js).
 */
export function codeGroups(code: string): string {
  let out = '';
  for (let i = 0; i < code.length; i += 4) out += (i === 0 ? '' : ' ') + code.slice(i, i + 4);
  return out;
}
