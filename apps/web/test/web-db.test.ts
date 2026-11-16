import { describe, expect, it } from 'vitest';
import { columnWords, forbiddenColumn, withDatabase } from './web-db';

/** The `pnpm test:web` helpers that need no database (RELAY step 29a). */

describe('forbiddenColumn', () => {
  it.each([
    'ip',
    'clientIp',
    'client_ip',
    'ipAddress',
    'IPv4',
    'remoteAddr',
    'streamUrl',
    'playlist_url',
    'serverURL',
    'epgUri',
    'host',
    'apiHostname',
    'providerDomain',
    'password',
    'xtreamPassword',
    'credentials',
    'username',
    'userAgent',
    'loginName',
    'email',
    'macAddress',
    'duid',
    'deviceDUID',
    'lgudid',
    'serialNumber',
  ])('rejects %s', (name) => {
    expect(forbiddenColumn(name)).toBe(true);
  });

  it.each([
    'id',
    'codeHash',
    'tvPk',
    'pollTokenHash',
    'payload',
    'status',
    'createdAt',
    'expiresAt',
    'lookupId',
    'writeTokenHash',
    'size',
    'updatedAt',
    'installId',
    'kind',
    'platform',
    'appVersion',
    'data',
    'at',
    'receivedAt',
    'code',
    'report',
    // Words that only contain a forbidden one.
    'description',
    'skipped',
    'passes',
    'hostage',
    'shipped',
    'macro',
  ])('allows %s', (name) => {
    expect(forbiddenColumn(name)).toBe(false);
  });

  it('splits camelCase, PascalCase, acronyms and snake_case into words', () => {
    expect(columnWords('pollTokenHash')).toStrictEqual(['poll', 'token', 'hash']);
    expect(columnWords('serverURLPath')).toStrictEqual(['server', 'url', 'path']);
    expect(columnWords('client_ip_v4')).toStrictEqual(['client', 'ip', 'v4']);
    expect(columnWords('clientIPAddress')).toStrictEqual(['client', 'ip', 'address']);
  });
});

describe('withDatabase', () => {
  it('keeps the server, the user and the options, and swaps the database', () => {
    expect(withDatabase('postgresql://lablo@127.0.0.1:54329/lablo?sslmode=disable', 'lablo_test')).toBe(
      'postgresql://lablo@127.0.0.1:54329/lablo_test?sslmode=disable',
    );
  });
});
