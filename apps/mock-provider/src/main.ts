// `pnpm mock [--port 8080] [--host 0.0.0.0] [--scenario <name|path>] [--fixtures <dir>]
//            [--lab-log-dir <dir> | --no-lab-logs] [--quiet]`
// Binds to all interfaces by default so TVs on the LAN can reach it.

import { networkInterfaces } from 'node:os';
import { parseArgs } from 'node:util';
import { buildServer } from './server';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: process.env['MOCK_PORT'] ?? '8080' },
    host: { type: 'string', default: process.env['MOCK_HOST'] ?? '0.0.0.0' },
    scenario: { type: 'string' },
    fixtures: { type: 'string' },
    'lab-log-dir': { type: 'string' },
    'no-lab-logs': { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
  },
});

const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Bad --port ${values.port}`);
  process.exit(2);
}

const app = await buildServer({
  fixturesDir: values.fixtures,
  scenario: values.scenario ?? null,
  labLogDir: values['no-lab-logs'] ? null : values['lab-log-dir'],
  logRequests: !values.quiet,
});

const address = await app.listen({ port, host: values.host });
const actualPort = new URL(address).port;
const hosts =
  values.host === '0.0.0.0'
    ? ['127.0.0.1', ...Object.values(networkInterfaces()).flatMap((list) => (list ?? []).filter((i) => i.family === 'IPv4' && !i.internal).map((i) => i.address))]
    : [values.host];

console.log('Zoma mock provider (test-signal server)');
for (const h of hosts) console.log(`  http://${h}:${actualPort}/`);
console.log(`Scenario: ${app.mockState.scenario?.name ?? 'none'}   Accounts: ${app.mockState.fixture.accounts.map((a) => a.username).join(', ')}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
