import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {once} from 'node:events';
import {startPlugin} from '../opendeck/codefriendly.streamdeck.sdPlugin/plugin.mjs';
import {ACTION, PLUGIN} from '../opendeck/codefriendly.streamdeck.sdPlugin/model.mjs';

class FakeHostSocket extends EventTarget {
  static OPEN = 1;
  static instances = [];
  readyState = 0;
  bufferedAmount = 0;
  messages = [];
  constructor(url) {
    super(); this.url = url; FakeHostSocket.instances.push(this);
    queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); });
  }
  send(text) { this.messages.push(JSON.parse(text)); this.dispatchEvent(new Event('outbound')); }
  host(value) { this.dispatchEvent(new MessageEvent('message', {data: JSON.stringify(value)})); }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3; this.dispatchEvent(new Event('close'));
  }
}
async function sent(socket, predicate) {
  for (;;) {
    const message = socket.messages.find(predicate);
    if (message) return message;
    await once(socket, 'outbound', {signal: AbortSignal.timeout(2000)});
  }
}

test('mock OpenDeck registration + isolated Unix bridge delivers native states', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'osd-proto-'));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  Object.defineProperty(globalThis, 'WebSocket', {value: FakeHostSocket, configurable: true});
  let stop, client;
  t.after(async () => {
    client?.destroy();
    if (stop) await stop();
    Object.defineProperty(globalThis, 'WebSocket', descriptor);
    await fs.rm(directory, {recursive: true, force: true});
  });
  stop = await startPlugin(['-port', '57116', '-pluginUUID', PLUGIN, '-registerEvent', 'registerPlugin', '-info', '{}'], directory);
  const host = FakeHostSocket.instances.at(-1);
  await sent(host, message => message.event === 'registerPlugin');
  assert.equal(host.url, 'ws://127.0.0.1:57116');
  assert.deepEqual(host.messages[0], {event: 'registerPlugin', uuid: PLUGIN});
  const context = 'sd-example.Workspaces/1 to 5.Keypad.0.0';
  host.host({event: 'willAppear', action: ACTION, context,
    payload: {settings: {monitor: 'HDMI-A-1', workspace: 1}, state: 0}});
  assert.equal(host.messages.at(-1).event, 'setTitle');
  client = net.createConnection(path.join(directory, 'omarchy-streamdeck', 'bridge.sock'));
  client.on('error', () => {});
  await once(client, 'connect');
  const changed = sent(host, message => message.event === 'setState' && message.payload.state === 5);
  client.write(JSON.stringify({version: 1, monitors: [{name: 'HDMI-A-1', focused: true, workspace: 1}],
    blocks: {'HDMI-A-1': 0}, counts: {1: 2}}) + '\n');
  assert.equal((await changed).context, context);
  const neutral = sent(host, message => message.event === 'setState' && message.payload.state === 0);
  client.destroy();
  await neutral;
  host.host({event: 'willDisappear', action: ACTION, context});
});
