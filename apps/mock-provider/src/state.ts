// Shared server state and small request helpers used by every route module.

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Account, Catalog, ServerFixture } from './config';
import type { FaultPlan, Scenario } from './faults';
import type { MediaSource } from './media';
import type { XmltvOffsetStyle } from './time';
import { startOfUtcDay } from './time';

/** Open long-lived streams per username, for `active_cons` and `max_connections`. */
export class ConnectionTracker {
  private readonly open = new Map<string, number>();

  count(username: string): number {
    return this.open.get(username) ?? 0;
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries([...this.open].filter(([, n]) => n > 0));
  }

  /** Counts a stream until the response closes. */
  hold(username: string, reply: FastifyReply): void {
    this.open.set(username, this.count(username) + 1);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      this.open.set(username, Math.max(0, this.count(username) - 1));
    };
    reply.raw.once('close', release);
    reply.raw.once('finish', release);
  }
}

export interface MockState {
  fixture: ServerFixture;
  catalog: Catalog;
  media: MediaSource;
  now: () => number;
  scenario: Scenario | null;
  scenariosDir: string;
  connections: ConnectionTracker;
}

export interface RequestMock {
  plan: FaultPlan;
  /** Panel time zone for this request (server.yaml, or a `timezone` fault). */
  tz: string;
  xmltv: XmltvOffsetStyle;
}

declare module 'fastify' {
  interface FastifyRequest {
    mock: RequestMock | null;
  }
}

export function requestTz(state: MockState, request: FastifyRequest): string {
  return request.mock?.tz ?? state.fixture.server.timezone;
}

/** `http://host:port` as the client addressed us, so LAN clients get LAN URLs back. */
export function baseUrl(request: FastifyRequest): string {
  return `http://${request.host || '127.0.0.1'}`;
}

/** Query and form parameters as strings (first value wins for repeated keys). */
export function requestParams(request: FastifyRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const source of [request.body, request.query]) {
    if (source === null || typeof source !== 'object' || Buffer.isBuffer(source)) continue;
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (key in out) continue;
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === 'string' || typeof first === 'number') out[key] = String(first);
    }
  }
  return out;
}

export function findAccount(state: MockState, username: string | undefined, password: string | undefined): Account | undefined {
  if (username === undefined || password === undefined) return undefined;
  return state.fixture.accounts.find((a) => a.username === username && a.password === password);
}

/** Epoch seconds of a date `days` from today (UTC midnight), stable for the whole day. */
export function dayOffsetSec(state: MockState, days: number): number {
  return Math.floor((startOfUtcDay(state.now()) + days * 86_400_000) / 1000);
}

export const enc = encodeURIComponent;

export function imageUrl(request: FastifyRequest, name: string): string {
  return `${baseUrl(request)}/images/${name}.png`;
}
