import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import {MAX_FRAME} from './model.mjs';

async function privateDirectory(directory, create = false) {
  if (create) await fs.mkdir(directory, {mode: 0o700});
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077))
    throw new Error('Bridge directory must be owned by this user and private');
}

async function clearStaleSocket(filename) {
  let original;
  try { original = await fs.lstat(filename); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!original.isSocket() || original.uid !== process.getuid()) throw new Error('Refusing to replace an unsafe bridge path');
  const active = await new Promise((resolve, reject) => {
    const probe = net.createConnection(filename);
    probe.setTimeout(500, () => { probe.destroy(); reject(new Error('Bridge probe timed out')); });
    probe.once('connect', () => { probe.destroy(); resolve(true); });
    probe.once('error', error => {
      probe.destroy();
      if (['ECONNREFUSED', 'ENOENT'].includes(error.code)) resolve(false);
      else reject(error);
    });
  });
  if (active) throw new Error('Another workspace bridge is already running');
  const current = await fs.lstat(filename).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (current && current.ino === original.ino && current.dev === original.dev && current.isSocket()) await fs.unlink(filename);
  else if (current) throw new Error('Bridge path changed during startup');
}

export async function createBridge(runtimeDir, receive, disconnected) {
  if (typeof runtimeDir !== 'string' || !path.isAbsolute(runtimeDir) || /[\x00-\x1f]/.test(runtimeDir))
    throw new Error('XDG_RUNTIME_DIR must be an absolute local directory');
  await privateDirectory(runtimeDir);
  const directory = path.join(runtimeDir, 'omarchy-streamdeck');
  try { await privateDirectory(directory, true); }
  catch (error) { if (error.code === 'EEXIST') await privateDirectory(directory); else throw error; }
  const filename = path.join(directory, 'bridge.sock');
  if (Buffer.byteLength(filename) > 100) throw new Error('Bridge socket path is too long');
  await clearStaleSocket(filename);
  let peer = null;
  const server = net.createServer(socket => {
    if (peer) { socket.destroy(); return; }
    peer = socket;
    let pending = '';
    socket.setEncoding('utf8');
    socket.setTimeout(7000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', chunk => {
      pending += chunk;
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (Buffer.byteLength(line) > MAX_FRAME) { socket.destroy(); return; }
        if (!line) continue;
        try { receive(JSON.parse(line)); }
        catch { socket.destroy(); return; }
      }
      if (Buffer.byteLength(pending) > MAX_FRAME) socket.destroy();
    });
    socket.on('close', () => {
      if (peer === socket) { peer = null; disconnected(); }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(filename, () => { server.removeListener('error', reject); resolve(); });
  });
  // The containing directory is already 0700, so no cross-user access window.
  await fs.chmod(filename, 0o600);
  const identity = await fs.lstat(filename);
  return {
    path: filename,
    close: async () => {
      peer?.destroy();
      await new Promise(resolve => server.close(resolve));
      const current = await fs.lstat(filename).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (current?.isSocket() && current.ino === identity.ino && current.dev === identity.dev) await fs.unlink(filename);
    },
  };
}
