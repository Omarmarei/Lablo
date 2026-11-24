import { describe, expect, it } from 'vitest';
import {
  AFTER_KEY_MS,
  AFTER_TEXT_MS,
  inputEndMessage,
  keyMessage,
  parseScript,
  remoteEvent,
  remotePath,
  runScript,
  textMessage,
} from './remote';

describe('the remote channel path', () => {
  it('names the client in base64 and adds the saved token', () => {
    expect(remotePath('LabloLabPC', undefined)).toBe('/api/v2/channels/samsung.remote.control?name=TGFibG9MYWJQQw==');
    expect(remotePath('LabloLabPC', '')).toBe('/api/v2/channels/samsung.remote.control?name=TGFibG9MYWJQQw==');
    expect(remotePath('LabloLabPC', '12345678')).toBe('/api/v2/channels/samsung.remote.control?name=TGFibG9MYWJQQw==&token=12345678');
    expect(remotePath('a', 'x y&z')).toBe('/api/v2/channels/samsung.remote.control?name=YQ==&token=x%20y%26z');
  });
});

describe('the messages', () => {
  it('presses a key as the session did', () => {
    expect(JSON.parse(keyMessage('KEY_CHUP'))).toEqual({
      method: 'ms.remote.control',
      params: { Cmd: 'Click', DataOfCmd: 'KEY_CHUP', Option: 'false', TypeOfRemote: 'SendRemoteKey' },
    });
  });

  it('types text in base64 of its UTF-8, Arabic included', () => {
    expect(JSON.parse(textMessage('http://10.0.0.2:8095'))).toEqual({
      method: 'ms.remote.control',
      params: { Cmd: 'aHR0cDovLzEwLjAuMC4yOjgwOTU=', DataOfCmd: 'base64', TypeOfRemote: 'SendInputString' },
    });
    const arabic = JSON.parse(textMessage('لابلو')) as { params: { Cmd: string } };
    expect(Buffer.from(arabic.params.Cmd, 'base64').toString('utf8')).toBe('لابلو');
  });

  it('closes the keyboard', () => {
    expect(JSON.parse(inputEndMessage())).toEqual({ method: 'ms.remote.control', params: { TypeOfRemote: 'SendInputEnd' } });
  });
});

describe('remoteEvent', () => {
  it('reads the connect event and its token, number or string', () => {
    expect(remoteEvent('{"event":"ms.channel.connect","data":{"clients":[],"id":"x","token":"12345678"}}')).toEqual({ type: 'connect', token: '12345678' });
    expect(remoteEvent('{"event":"ms.channel.connect","data":{"token":12345678}}')).toEqual({ type: 'connect', token: '12345678' });
    expect(remoteEvent('{"event":"ms.channel.connect","data":{"id":"x"}}')).toEqual({ type: 'connect', token: null });
    expect(remoteEvent('{"event":"ms.channel.connect","data":{"token":true}}')).toEqual({ type: 'connect', token: null });
    expect(remoteEvent('{"event":"ms.channel.connect"}')).toEqual({ type: 'connect', token: null });
    expect(remoteEvent('{"event":"ms.channel.connect","data":null}')).toEqual({ type: 'connect', token: null });
  });

  it('reads a refusal and the keyboard events', () => {
    expect(remoteEvent('{"event":"ms.channel.unauthorized"}')).toEqual({ type: 'unauthorized' });
    expect(remoteEvent('{"event":"ms.remote.imeStart","data":"x"}')).toEqual({ type: 'ime-start' });
    expect(remoteEvent('{"event":"ms.remote.imeEnd"}')).toEqual({ type: 'ime-end' });
  });

  it('passes anything else on by name', () => {
    expect(remoteEvent('{"event":"ms.channel.clientConnect"}')).toEqual({ type: 'other', event: 'ms.channel.clientConnect' });
    expect(remoteEvent('{"data":1}')).toEqual({ type: 'other', event: '(no event)' });
    expect(remoteEvent('[1]')).toEqual({ type: 'other', event: '(no event)' });
    expect(remoteEvent('"text"')).toEqual({ type: 'other', event: '(not an object)' });
    expect(remoteEvent('null')).toEqual({ type: 'other', event: '(not an object)' });
    expect(remoteEvent('{not json')).toEqual({ type: 'other', event: '(not JSON)' });
  });
});

describe('parseScript', () => {
  it('reads keys, pauses, text and END as tvraw.mjs did', () => {
    expect(parseScript(['KEY_DOWN', '800', 'KEY_ENTER', 'TEXT:abc', 'TEXT:', 'TEXT:a b:c', 'END', 'KEY_3'])).toEqual([
      { kind: 'key', key: 'KEY_DOWN' },
      { kind: 'pause', ms: 800 },
      { kind: 'key', key: 'KEY_ENTER' },
      { kind: 'text', text: 'abc' },
      { kind: 'text', text: '' },
      { kind: 'text', text: 'a b:c' },
      { kind: 'end' },
      { kind: 'key', key: 'KEY_3' },
    ]);
    expect(parseScript([])).toEqual([]);
  });

  it('refuses anything else before a key is sent', () => {
    for (const token of ['key_down', 'KEY_', 'KEY_down', 'DOWN', '-5', '1.5', 'end', 'text:abc', ' KEY_UP', 'KEY_UP ']) {
      expect(parseScript(['KEY_UP', token])).toBe(`"${token}" is not a key (KEY_...), a pause in ms, TEXT:<text> or END`);
    }
  });
});

describe('runScript', () => {
  it('sends each step in order with the pauses', async () => {
    const events: string[] = [];
    await runScript(
      { send: (text) => events.push(`send ${(JSON.parse(text) as { params: { TypeOfRemote: string } }).params.TypeOfRemote}`) },
      [{ kind: 'key', key: 'KEY_UP' }, { kind: 'pause', ms: 1200 }, { kind: 'text', text: 'ab' }, { kind: 'end' }],
      async (ms) => {
        events.push(`sleep ${ms}`);
      },
      (line) => events.push(`log ${line}`),
    );
    expect(events).toEqual([
      'send SendRemoteKey',
      'log sent KEY_UP',
      `sleep ${AFTER_KEY_MS}`,
      'sleep 1200',
      'send SendInputString',
      'log typed 2 characters',
      `sleep ${AFTER_TEXT_MS}`,
      'send SendInputEnd',
      'log closed the keyboard',
      `sleep ${AFTER_TEXT_MS}`,
    ]);
    expect([AFTER_KEY_MS, AFTER_TEXT_MS]).toEqual([500, 800]);
  });
});
