export const PLUGIN = 'codefriendly.streamdeck.sdPlugin';
export const ACTION = 'codefriendly.streamdeck.workspace';
export const MAX_FRAME = 65536;
export const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
export const connector = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function settings(value) {
  return object(value) && connector(value.monitor) && integer(value.workspace, 1, 10)
    ? {monitor: value.monitor, workspace: value.workspace} : null;
}

export function context(value) {
  if (typeof value !== 'string' || value.length > 512 || /[\x00-\x1f]/.test(value)) return false;
  const parts = value.split('.');
  return parts.length === 5 && parts[0].length > 0 && parts[1].length > 0 && parts[2] === 'Keypad'
    && /^(0|[1-9][0-9]{0,2})$/.test(parts[3]) && Number(parts[3]) <= 255 && parts[4] === '0';
}

export function snapshot(value) {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.monitors) || value.monitors.length > 32
      || !object(value.blocks) || !object(value.counts) || Object.keys(value.blocks).length > 32
      || Object.keys(value.counts).length > 4096) throw new Error('Invalid desktop snapshot');
  const monitors = value.monitors.map(monitor => {
    if (!object(monitor) || !connector(monitor.name) || typeof monitor.focused !== 'boolean'
        || !integer(monitor.workspace, -100000, 100010)) throw new Error('Invalid monitor');
    return {name: monitor.name, focused: monitor.focused, workspace: monitor.workspace};
  });
  if (new Set(monitors.map(monitor => monitor.name)).size !== monitors.length) throw new Error('Duplicate monitor');
  const blocks = Object.create(null), counts = Object.create(null);
  for (const [name, block] of Object.entries(value.blocks)) {
    if (!connector(name) || !integer(block, 0, 10000)) throw new Error('Invalid monitor block');
    blocks[name] = block;
  }
  for (const [id, count] of Object.entries(value.counts)) {
    if (!/^[1-9][0-9]{0,5}$/.test(id) || !integer(Number(id), 1, 100010) || !integer(count, 0, 4096)) throw new Error('Invalid window count');
    counts[id] = count;
  }
  return {version: 1, monitors, blocks, counts};
}

export function stateFor(desktop, config) {
  if (!desktop || !config) return 0;
  const monitor = desktop.monitors.find(item => item.name === config.monitor);
  const block = desktop.blocks[config.monitor];
  if (!monitor || !integer(block, 0, 10000)) return 0;
  const id = block * 10 + config.workspace;
  const role = monitor.workspace === id ? (monitor.focused ? 2 : 1) : 0;
  return role * 2 + (desktop.counts[id] > 0 ? 1 : 0);
}

export function focusCommand(value) {
  const config = settings(value);
  if (!config) throw new Error('Invalid workspace settings');
  return ['hyprctl', ['dispatch', `o.workspaces.focus(${config.workspace}, ${JSON.stringify(config.monitor)})`]];
}

export class ActionEngine {
  constructor(send, run) {
    this.send = send;
    this.run = run;
    this.actions = new Map();
    this.desktop = null;
  }

  receive(event) {
    if (!object(event) || event.action !== ACTION || !context(event.context)) return;
    if (event.event === 'willDisappear') { this.actions.delete(event.context); return; }
    if (event.event === 'willAppear' || event.event === 'didReceiveSettings') {
      if (!this.actions.has(event.context) && this.actions.size >= 256) return;
      const previous = this.actions.get(event.context);
      const config = settings(event.payload?.settings);
      const entry = {config, title: previous?.title,
        state: integer(event.payload?.state, 0, 5) ? event.payload.state : undefined};
      this.actions.set(event.context, entry);
      this.update(event.context, entry);
    } else if (event.event === 'keyUp') {
      const entry = this.actions.get(event.context);
      if (!entry) return;
      const config = settings(event.payload?.settings);
      if (!config || !this.run(focusCommand(config))) this.send({event: 'showAlert', context: event.context});
    }
  }

  update(id, entry) {
    const title = entry.config ? String(entry.config.workspace) : '?';
    if (entry.title !== title && this.send({event: 'setTitle', context: id, payload: {title}})) entry.title = title;
    const state = stateFor(this.desktop, entry.config);
    if (entry.state !== state && this.send({event: 'setState', context: id, payload: {state}})) entry.state = state;
  }

  refresh() { for (const [id, entry] of this.actions) this.update(id, entry); }
  receiveDesktop(value) { this.desktop = snapshot(value); this.refresh(); }
  invalidate() { this.desktop = null; this.refresh(); }
  resetTransport() {
    for (const entry of this.actions.values()) { entry.title = undefined; entry.state = undefined; }
  }
}
