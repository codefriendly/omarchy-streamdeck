/* OpenDeck calls this global function after loading the property inspector. */
let activeSocket = null;
window.connectOpenActionSocket = function(port, inspectorId, registerEvent, info, actionInfo) {
  const monitor = document.getElementById('monitor');
  const workspace = document.getElementById('workspace');
  const save = document.getElementById('save');
  const status = document.getElementById('status');
  const form = document.getElementById('target');
  const message = (text, error = false) => { status.textContent = text; status.dataset.error = String(error); };
  const enabled = value => { monitor.disabled = workspace.disabled = save.disabled = !value; };
  let action;
  try {
    if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535
        || registerEvent !== 'registerPropertyInspector' || typeof actionInfo !== 'string' || actionInfo.length > 262144)
      throw new Error();
    action = JSON.parse(actionInfo);
    if (action.action !== 'codefriendly.streamdeck.workspace' || action.context !== inspectorId
        || typeof inspectorId !== 'string' || inspectorId.length > 512 || /[\x00-\x1f]/.test(inspectorId)) throw new Error();
  } catch { message('Could not read this action. Close and reopen its settings.', true); return; }
  let displayedSettings;
  const showSettings = value => {
    displayedSettings = {
      monitor: typeof value?.monitor === 'string' ? value.monitor : '',
      workspace: Number.isInteger(value?.workspace) ? value.workspace : 1,
    };
    monitor.value = displayedSettings.monitor;
    workspace.value = displayedSettings.workspace;
  };
  const dirty = () => monitor.value !== displayedSettings.monitor
    || String(workspace.value) !== String(displayedSettings.workspace);
  showSettings(action.payload?.settings);
  activeSocket?.close();
  const socket = activeSocket = new WebSocket(`ws://127.0.0.1:${Number(port)}`);
  let phase = 'loading';
  let pendingTarget = null;
  enabled(false);
  socket.onopen = () => {
    if (activeSocket !== socket) return;
    socket.send(JSON.stringify({event: registerEvent, uuid: inspectorId}));
    socket.send(JSON.stringify({event: 'getSettings', context: action.context}));
    message('Loading target…');
  };
  socket.onmessage = event => {
    if (activeSocket !== socket || typeof event.data !== 'string' || event.data.length > 65536) return;
    try {
      const value = JSON.parse(event.data);
      if (value.event !== 'didReceiveSettings' || value.context !== action.context) return;
      const returned = value.payload?.settings;
      if (phase === 'saving') {
        if (returned?.monitor !== pendingTarget.monitor || returned?.workspace !== pendingTarget.workspace) return;
        showSettings(returned);
        pendingTarget = null;
        phase = 'ready';
        enabled(true);
        message('Target saved.');
      } else if (phase === 'loading' || (phase === 'ready' && !dirty())) {
        showSettings(returned);
        phase = 'ready';
        enabled(true);
        message('Choose a monitor and workspace, then save.');
      }
    } catch { message('Could not read saved settings. Reopen this inspector.', true); }
  };
  socket.onclose = () => {
    if (activeSocket !== socket) return;
    phase = 'disconnected';
    pendingTarget = null;
    enabled(false);
    message('Disconnected. Close and reopen the action settings.', true);
  };
  socket.onerror = () => {
    if (activeSocket === socket) message('Could not connect to OpenDeck. Reopen this inspector.', true);
  };
  form.onsubmit = event => {
    event.preventDefault();
    if (phase !== 'ready') return;
    const name = monitor.value.trim();
    const slot = Number(workspace.value);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(name)) { message('Enter a connector name, such as HDMI-A-1.', true); monitor.focus(); return; }
    if (!Number.isInteger(slot) || slot < 1 || slot > 10) { message('Choose a workspace from 1 to 10.', true); workspace.focus(); return; }
    if (socket.readyState !== WebSocket.OPEN) { message('OpenDeck is disconnected. Reopen this inspector.', true); return; }
    enabled(false);
    phase = 'saving';
    pendingTarget = {monitor: name, workspace: slot};
    message('Saving target…');
    socket.send(JSON.stringify({event: 'setSettings', context: action.context, payload: pendingTarget}));
    socket.send(JSON.stringify({event: 'getSettings', context: action.context}));
  };
};
window.connectElgatoStreamDeckSocket = window.connectOpenActionSocket;
