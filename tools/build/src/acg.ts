/**
 * LG's Access Control Groups (ACG, ADR-012): a webOS app lists in appinfo.json's `requiredACG`
 * the group of every luna API it calls. webOS TV 25 and older ignore the field, 26 can enforce
 * it, and 27+ enforces it on the TV and in the Seller Lounge's checks (apps without the field
 * can't be submitted). A call whose group is missing fails with errorCode -1, "Denied method
 * call". Source: https://webostv.developer.lge.com/develop/guides/acg-guide
 *
 * The rule: every new luna call goes into `LUNA_ACG` with LG's group, and that group into the
 * manifest of each app that calls it. A service LG's ACG table doesn't list (`null` here) is a
 * fallback only, never the primary route: webOS 27 will most likely deny it.
 */

/** Each luna API in our code and its ACG group, or `null` when LG's ACG table doesn't list it. */
export const LUNA_ACG: Readonly<Record<string, string | null>> = {
  // deviceSecret (the LGUDID): S3, later the pairing.
  'luna://com.webos.service.sm/deviceid/getIDs': 'deviceinfo.query',
  // screenReader (Audio Guidance on or off): S11.
  'luna://com.webos.settingsservice/getSystemSettings': 'settings.query',
  // Not called yet: the webOS version (`sdkVersion`) the way webOSTV.js reads it.
  'luna://com.webos.service.tv.systemproperty/getSystemInfo': 'systemconfig.query',
  // speak: S11. Not in LG's table; Audio Guidance reads labelled focus by itself.
  'luna://com.webos.service.tts/speak': null,
  // webosSelectTrack: S5. Not in LG's table; `audioTracks` switched in 154 ms on the LG TV.
  'luna://com.webos.media/selectTrack': null,
};

/**
 * The lab's groups: the luna calls its spikes make (S3's LGUDID, S11's Audio Guidance). The
 * app's own manifest (platforms/webos/appinfo.json) declares none: no app code calls a luna API
 * yet, although the adapter's luna-backed `Platform` methods are in its bundle.
 */
export const LAB_ACG: readonly string[] = ['deviceinfo.query', 'settings.query'];

/**
 * The luna-backed `Platform` methods and the URI each one calls: app code that calls one needs
 * its group in the app's manifest (acg.test.ts scans the app's source for them).
 */
export const PLATFORM_LUNA_CALLS: Readonly<Record<string, string>> = {
  deviceSecret: 'luna://com.webos.service.sm/deviceid/getIDs',
  screenReader: 'luna://com.webos.settingsservice/getSystemSettings',
  speak: 'luna://com.webos.service.tts/speak',
};

/** The distinct `luna://service/method` URIs in a bundle, in order of first appearance. */
export function lunaUris(code: string): string[] {
  const found: string[] = [];
  for (const match of code.matchAll(/luna:\/\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+/g)) {
    if (!found.includes(match[0])) found.push(match[0]);
  }
  return found;
}

/**
 * Checks a webOS bundle against its manifest's `requiredACG`: the field must be an array of
 * groups LUNA_ACG knows, and every luna URI in the bundle must be in LUNA_ACG. With
 * `declareBundle` (the lab, whose spikes call everything they carry), each URI's group must
 * be declared too. Returns the problems, empty when all is well.
 */
export function checkAcg(code: string, requiredAcg: unknown, { declareBundle }: { declareBundle: boolean }): string[] {
  if (!Array.isArray(requiredAcg) || !requiredAcg.every((group) => typeof group === 'string')) {
    return ['"requiredACG" must be an array of ACG group names ([] when no luna API is called)'];
  }
  const declared = requiredAcg as string[];
  const known = new Set(Object.values(LUNA_ACG).filter((group): group is string => group !== null));
  const problems: string[] = [];
  for (const group of declared) {
    if (!known.has(group)) problems.push(`"requiredACG" has "${group}", which no luna call in LUNA_ACG (tools/build/src/acg.ts) needs`);
  }
  for (const uri of lunaUris(code)) {
    if (!(uri in LUNA_ACG)) {
      problems.push(`${uri} is not in LUNA_ACG (tools/build/src/acg.ts): add it with its group from LG's ACG guide, or null if LG doesn't list it`);
      continue;
    }
    const group = LUNA_ACG[uri];
    if (declareBundle && group !== null && group !== undefined && !declared.includes(group)) {
      problems.push(`${uri} needs "${group}" in "requiredACG"`);
    }
  }
  return problems;
}
