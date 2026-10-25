import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createBridge} from '../opendeck/codefriendly.streamdeck.sdPlugin/bridge.mjs';
import {snapshot, MAX_FRAME} from '../opendeck/codefriendly.streamdeck.sdPlugin/model.mjs';

async function runtime(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'osd-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  return directory;
}
async function client(t, bridge) {
  const socket = net.createConnection(bridge.path);
  socket.on('error', () => {});
  t.after(() => socket.destroy());
  await once(socket, 'connect');
  return socket;
}
const frame = {version: 1, monitors: [], blocks: {}, counts: {}};

async function framedInput(t, expected, write) {
  const directory = await runtime(t);
  const received = [];
  let finish;
  const outcome = new Promise(resolve => finish = resolve);
  const bridge = await createBridge(directory, value => {
    received.push(snapshot(value));
    if (received.length >= Math.max(expected, 1)) finish('received');
  }, () => finish('disconnected'));
  let socket;
  const timer = setTimeout(() => finish('timeout'), 1000);
  try {
    socket = await client(t, bridge);
    await write(socket);
    return {outcome: await outcome, received};
  } finally {
    clearTimeout(timer);
    socket?.destroy();
    await bridge.close();
  }
}

function frameBytes(bytes) {
  const overhead = Buffer.byteLength(JSON.stringify({...frame, padding: ''}));
  const padding = bytes - overhead;
  return JSON.stringify({...frame, padding: 'é'.repeat(Math.floor(padding / 2)) + 'x'.repeat(padding % 2)});
}

test('bridge accepts split large frames when a chunk also contains the next frame', async t => {
  const large = {...frame, counts: Object.fromEntries(Array.from({length: 4096}, (_, index) => [index + 1, 1]))};
  snapshot(large);
  const line = JSON.stringify(large) + '\n';
  assert.ok(Buffer.byteLength(line) < MAX_FRAME);
  assert.ok(Buffer.byteLength(line + line) > MAX_FRAME);
  const result = await framedInput(t, 2, async socket => {
    socket.write(line.slice(0, 30000));
    await delay(30);
    socket.write(line.slice(30000) + line);
  });
  assert.equal(result.outcome, 'received');
  assert.equal(result.received.length, 2);
  assert.deepEqual(result.received[0].counts, snapshot(large).counts);
  assert.deepEqual(result.received[1].counts, snapshot(large).counts);
});

test('bridge frame limit counts UTF-8 payload bytes, excluding the newline delimiter', async t => {
  const body = frameBytes(MAX_FRAME);
  assert.equal(Buffer.byteLength(body), MAX_FRAME);
  assert.ok(body.length < MAX_FRAME);
  const result = await framedInput(t, 1, socket => socket.write(body + '\n'));
  assert.equal(result.outcome, 'received');
  assert.equal(result.received.length, 1);
});

test('bridge rejects oversized UTF-8 frames with or without a delimiter', async t => {
  const body = frameBytes(MAX_FRAME + 1);
  assert.equal(Buffer.byteLength(body), MAX_FRAME + 1);
  assert.ok(body.length < MAX_FRAME);
  for (const suffix of ['\n', '']) {
    const result = await framedInput(t, 0, socket => socket.write(body + suffix));
    assert.equal(result.outcome, 'disconnected');
    assert.equal(result.received.length, 0);
  }
});

test('private bridge accepts fragmented newline snapshots and cleans up its socket', async t => {
  const directory = await runtime(t);
  let resolve;
  const received = new Promise(done => resolve = done);
  const bridge = await createBridge(directory, value => resolve(snapshot(value)), () => {});
  const socket = await client(t, bridge);
  const text = JSON.stringify(frame);
  socket.write(text.slice(0, 10));
  socket.write(text.slice(10) + '\n');
  assert.equal((await received).version, 1);
  assert.equal((await fs.stat(path.dirname(bridge.path))).mode & 0o077, 0);
  assert.equal((await fs.stat(bridge.path)).mode & 0o077, 0);
  await bridge.close();
  await assert.rejects(fs.stat(bridge.path), {code: 'ENOENT'});
});
test('malformed and oversized frames disconnect instead of becoming commands', async t => {
  for (const value of ['not-json\n', JSON.stringify({version: 99}) + '\n', 'x'.repeat(MAX_FRAME + 1)]) {
    const directory = await runtime(t);
    let disconnect;
    const closed = new Promise(resolve => disconnect = resolve);
    const bridge = await createBridge(directory, snapshot, disconnect);
    const socket = await client(t, bridge);
    socket.write(value);
    await closed;
    await bridge.close();
  }
});
test('duplicate bridge instances do not replace an active socket', async t => {
  const directory = await runtime(t);
  const bridge = await createBridge(directory, snapshot, () => {});
  const before = await fs.lstat(bridge.path);
  await assert.rejects(createBridge(directory, snapshot, () => {}), /already running/);
  assert.equal((await fs.lstat(bridge.path)).ino, before.ino);
  await bridge.close();
});
test('unsafe directories and non-socket paths are refused without deleting data', async t => {
  const directory = await runtime(t);
  await fs.chmod(directory, 0o755);
  await assert.rejects(createBridge(directory, snapshot, () => {}), /private/);
  await fs.chmod(directory, 0o700);
  const child = path.join(directory, 'omarchy-streamdeck');
  await fs.mkdir(child, {mode: 0o700});
  const filename = path.join(child, 'bridge.sock');
  await fs.writeFile(filename, 'preserve me', {mode: 0o600});
  await assert.rejects(createBridge(directory, snapshot, () => {}), /unsafe bridge path/);
  assert.equal(await fs.readFile(filename, 'utf8'), 'preserve me');
});
