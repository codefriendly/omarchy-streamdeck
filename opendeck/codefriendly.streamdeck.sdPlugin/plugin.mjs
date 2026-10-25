import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {ActionEngine, MAX_FRAME, PLUGIN} from './model.mjs';
import {createBridge} from './bridge.mjs';

export function parseArgs(args) {
  const options = Object.create(null);
  if (args.length !== 8 || args.some(value => typeof value !== 'string' || value.length > 131072)) throw new Error('Invalid host arguments');
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!['-port', '-pluginUUID', '-registerEvent', '-info'].includes(name) || Object.hasOwn(options, name)) throw new Error('Invalid host arguments');
    options[name] = args[index + 1];
  }
  if (!/^[0-9]{1,5}$/.test(options['-port']) || Number(options['-port']) < 1 || Number(options['-port']) > 65535
      || options['-pluginUUID'] !== PLUGIN || options['-registerEvent'] !== 'registerPlugin') throw new Error('Invalid host registration');
  return {port: Number(options['-port'])};
}

export async function startPlugin(args, runtimeDir) {
  const {port} = parseArgs(args);
  if (typeof WebSocket !== 'function') throw new Error('Node.js 22 or newer is required');
  let socket = null, reconnect = null, connectionTimeout = null, stopped = false;
  let lastDesktop = 0, lastPress = 0;
  const children = new Set();
  const send = message => {
    if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 1048576) return false;
    socket.send(JSON.stringify(message));
    return true;
  };
  const run = ([program, argv]) => {
    if (stopped || children.size >= 4 || Date.now() - lastPress < 25) return false;
    lastPress = Date.now();
    const child = spawn(program, argv, {stdio: 'ignore', shell: false});
    children.add(child);
    const timeout = setTimeout(() => child.kill('SIGKILL'), 2000);
    child.once('error', () => {});
    child.once('close', () => { clearTimeout(timeout); children.delete(child); });
    return true;
  };
  const engine = new ActionEngine(send, run);
  const bridge = await createBridge(runtimeDir, value => {
    engine.receiveDesktop(value);
    lastDesktop = Date.now();
  }, () => { lastDesktop = 0; engine.invalidate(); });

  function connect() {
    if (stopped) return;
    socket = new WebSocket(`ws://127.0.0.1:${port}`);
    connectionTimeout = setTimeout(() => socket?.close(), 3000);
    socket.addEventListener('open', () => {
      clearTimeout(connectionTimeout);
      send({event: 'registerPlugin', uuid: PLUGIN});
      engine.resetTransport();
      engine.refresh();
    });
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string' || Buffer.byteLength(event.data) > MAX_FRAME) { socket.close(); return; }
      try { engine.receive(JSON.parse(event.data)); }
      catch { /* Malformed host messages never become commands. */ }
    });
    socket.addEventListener('error', () => {});
    socket.addEventListener('close', () => {
      clearTimeout(connectionTimeout);
      if (!stopped) reconnect = setTimeout(connect, 2000);
    });
  }
  connect();
  const heartbeat = setInterval(() => {
    if (lastDesktop && Date.now() - lastDesktop > 6000) {
      lastDesktop = 0;
      engine.invalidate();
    }
  }, 1000);
  return async () => {
    stopped = true;
    clearTimeout(reconnect);
    clearTimeout(connectionTimeout);
    clearInterval(heartbeat);
    socket?.close();
    for (const child of children) child.kill('SIGKILL');
    await bridge.close();
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startPlugin(process.argv.slice(2), process.env.XDG_RUNTIME_DIR).then(stop => {
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      stop().finally(() => process.exit(0));
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }).catch(() => {
    console.error('OpenDeck workspace plugin could not start. Check Node.js 22+, host arguments and the private runtime directory.');
    process.exitCode = 1;
  });
}
