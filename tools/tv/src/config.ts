/**
 * `.tv.local.json` at the repo root: the TV `pnpm tv` drives. It is gitignored because it holds
 * the TV's LAN address and the remote's token, and the repo is public. `pnpm tv setup <host>`
 * writes it; nothing here ever prints the token.
 */
export const CONFIG_FILE = '.tv.local.json';

/** The Samsung session's client name, so a token it was given still works. */
export const DEFAULT_NAME = 'LabloLabPC';
/** sdb's TV port ("an internal device port", docs/runbooks/tv-setup.md 3.3). */
export const SDB_PORT = 26101;

export interface TvConfig {
  /** The TV's LAN address. */
  readonly host: string;
  /** sdb's serial; default `<host>:26101`. */
  readonly serial?: string;
  /** The remote's client name, shown on the TV's "Allow" prompt. */
  readonly name?: string;
  /** The remote's token from `ms.channel.connect`. */
  readonly token?: string;
  /** The inspector's port, forwarded by `pnpm tv inspect`. */
  readonly cdpPort?: number;
}

/** The config from the file's text, or what is wrong with it. */
export function parseTvConfig(text: string): TvConfig | string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return `${CONFIG_FILE} is not JSON`;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${CONFIG_FILE} is not an object`;
  const { host, serial, name, token, cdpPort } = value as Record<string, unknown>;
  if (typeof host !== 'string' || host.trim() === '') return `${CONFIG_FILE} has no "host"`;
  for (const [field, item] of [['serial', serial], ['name', name], ['token', token]] as const) {
    if (item !== undefined && typeof item !== 'string') return `${CONFIG_FILE}: "${field}" must be a string`;
  }
  if (cdpPort !== undefined && !isPort(cdpPort)) return `${CONFIG_FILE}: "cdpPort" must be a port number`;
  return {
    host: host.trim(),
    ...(serial === undefined ? {} : { serial: serial as string }),
    ...(name === undefined ? {} : { name: name as string }),
    ...(token === undefined ? {} : { token: token as string }),
    ...(cdpPort === undefined ? {} : { cdpPort: cdpPort as number }),
  };
}

export function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65_535;
}

export function tvSerial(config: TvConfig): string {
  return config.serial ?? `${config.host}:${SDB_PORT}`;
}

export function clientName(config: TvConfig): string {
  return config.name ?? DEFAULT_NAME;
}

/**
 * `pnpm tv setup <host> [serial]`: a new host starts afresh (a token and a port belong to one TV);
 * the same host keeps them.
 */
export function setupConfig(previous: TvConfig | null, host: string, serial: string | undefined): TvConfig {
  const base: TvConfig = previous !== null && previous.host === host ? previous : { host };
  return serial === undefined ? base : { ...base, serial };
}

/** The file's text, keys in a fixed order. */
export function formatTvConfig(config: TvConfig): string {
  const ordered = {
    host: config.host,
    serial: config.serial,
    name: config.name,
    token: config.token,
    cdpPort: config.cdpPort,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
