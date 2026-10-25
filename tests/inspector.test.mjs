import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

async function inspector() {
  const elements = Object.fromEntries(['monitor', 'workspace', 'save', 'status', 'target'].map(id => [id,
    {value: '', disabled: true, textContent: '', dataset: {}, focus() { this.focused = true; }}]));
  const sockets = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    messages = [];
    constructor(url) { this.url = url; sockets.push(this); }
    send(value) { this.messages.push(JSON.parse(value)); }
    close() { this.onclose?.(); }
  }
  const scope = vm.createContext({window: {}, document: {getElementById: id => elements[id]}, WebSocket: Socket});
  vm.runInContext(await fs.readFile(new URL('../opendeck/codefriendly.streamdeck.sdPlugin/inspector.js', import.meta.url), 'utf8'), scope);
  const context = 'sd-example.Workspaces/1 to 5.Keypad.0.0';
  const action = {action: 'codefriendly.streamdeck.workspace', context, payload: {settings: {monitor: 'HDMI-A-1', workspace: 1}}};
  return {elements, sockets, scope, context, action};
}

test('inspector registers, saves validated target settings, and waits for acknowledgment', async () => {
  const {elements, sockets, scope, context, action} = await inspector();
  scope.window.connectOpenActionSocket(57116, context, 'registerPropertyInspector', '{}', JSON.stringify(action));
  const socket = sockets[0]; socket.onopen();
  assert.equal(socket.messages[0].event, 'registerPropertyInspector');
  assert.equal(socket.messages[1].event, 'getSettings');
  socket.onmessage({data: JSON.stringify({event: 'didReceiveSettings', context, payload: action.payload})});
  elements.monitor.value = 'DP-1'; elements.workspace.value = '10';
  elements.target.onsubmit({preventDefault() {}});
  const save = socket.messages.find(message => message.event === 'setSettings');
  assert.deepEqual(JSON.parse(JSON.stringify(save.payload)), {monitor: 'DP-1', workspace: 10});
  assert.equal(elements.save.disabled, true);
  socket.onmessage({data: JSON.stringify({event: 'didReceiveSettings', context, payload: {settings: save.payload}})});
  assert.equal(elements.status.textContent, 'Target saved.');
  assert.equal(elements.save.disabled, false);
});
test('inspector refuses command-like connector values without transmitting them', async () => {
  const {elements, sockets, scope, context, action} = await inspector();
  scope.window.connectOpenActionSocket(57116, context, 'registerPropertyInspector', '{}', JSON.stringify(action));
  const socket = sockets[0]; socket.onopen();
  socket.onmessage({data: JSON.stringify({event: 'didReceiveSettings', context, payload: action.payload})});
  elements.monitor.value = 'DP-1;sh'; elements.workspace.value = '1';
  elements.target.onsubmit({preventDefault() {}});
  assert.equal(socket.messages.some(message => message.event === 'setSettings'), false);
  assert.equal(elements.monitor.focused, true);
  assert.equal(elements.status.dataset.error, 'true');
});
test('inspector stays disabled while loading and guards early submission', async () => {
  const {elements, sockets, scope, context, action} = await inspector();
  scope.window.connectOpenActionSocket(57116, context, 'registerPropertyInspector', '{}', JSON.stringify(action));
  const socket = sockets[0]; socket.onopen();
  for (const id of ['monitor', 'workspace', 'save']) assert.equal(elements[id].disabled, true);
  elements.monitor.value = 'DP-1'; elements.workspace.value = '10';
  elements.target.onsubmit({preventDefault() {}});
  assert.equal(socket.messages.some(message => message.event === 'setSettings'), false);
  socket.onmessage({data: JSON.stringify({event: 'didReceiveSettings', context, payload: action.payload})});
  for (const id of ['monitor', 'workspace', 'save']) assert.equal(elements[id].disabled, false);
  assert.equal(elements.monitor.value, 'HDMI-A-1');
  assert.equal(String(elements.workspace.value), '1');
  assert.notEqual(elements.status.textContent, 'Target saved.');
});

test('inspector confirms only a matching save response and preserves the pending target', async () => {
  const {elements, sockets, scope, context, action} = await inspector();
  scope.window.connectOpenActionSocket(57116, context, 'registerPropertyInspector', '{}', JSON.stringify(action));
  const socket = sockets[0]; socket.onopen();
  socket.onmessage({data: JSON.stringify({event: 'didReceiveSettings', context, payload: action.payload})});
  const submitted = {monitor: 'DP-1', workspace: 10};
  elements.monitor.value = submitted.monitor; elements.workspace.value = String(submitted.workspace);
  elements.target.onsubmit({preventDefault() {}});
  for (const returned of [action.payload.settings, {monitor: 'DP-1', workspace: 9}, {monitor: 'DP-2', workspace: 10}, {}]) {
    socket.onmessage({data: JSON.stringify({event: 'didReceiveSettings', context, payload: {settings: returned}})});
    assert.equal(elements.monitor.value, submitted.monitor);
    assert.equal(String(elements.workspace.value), '10');
    for (const id of ['monitor', 'workspace', 'save']) assert.equal(elements[id].disabled, true);
    assert.notEqual(elements.status.textContent, 'Target saved.');
  }
  elements.target.onsubmit({preventDefault() {}});
  assert.equal(socket.messages.filter(message => message.event === 'setSettings').length, 1);
  socket.onmessage({data: JSON.stringify({event: 'didReceiveSettings', context, payload: {settings: submitted}})});
  assert.equal(elements.status.textContent, 'Target saved.');
  for (const id of ['monitor', 'workspace', 'save']) assert.equal(elements[id].disabled, false);
});

test('inspector preserves dirty edits on unrelated settings responses after initialization', async () => {
  const {elements, sockets, scope, context, action} = await inspector();
  scope.window.connectOpenActionSocket(57116, context, 'registerPropertyInspector', '{}', JSON.stringify(action));
  const socket = sockets[0]; socket.onopen();
  socket.onmessage({data: JSON.stringify({event: 'didReceiveSettings', context, payload: action.payload})});
  for (const edit of [{monitor: 'DP-2', workspace: '1'}, {monitor: 'HDMI-A-1', workspace: '4'}, {monitor: '', workspace: ''}]) {
    elements.monitor.value = edit.monitor; elements.workspace.value = edit.workspace;
    socket.onmessage({data: JSON.stringify({event: 'didReceiveSettings', context,
      payload: {settings: {monitor: 'eDP-1', workspace: 3}}})});
    assert.equal(elements.monitor.value, edit.monitor);
    assert.equal(String(elements.workspace.value), edit.workspace);
    assert.equal(elements.save.disabled, false);
    assert.notEqual(elements.status.textContent, 'Target saved.');
  }
});

test('inspector can refresh pristine fields without treating the response as a save', async () => {
  const {elements, sockets, scope, context, action} = await inspector();
  scope.window.connectOpenActionSocket(57116, context, 'registerPropertyInspector', '{}', JSON.stringify(action));
  const socket = sockets[0]; socket.onopen();
  socket.onmessage({data: JSON.stringify({event: 'didReceiveSettings', context, payload: action.payload})});
  socket.onmessage({data: JSON.stringify({event: 'didReceiveSettings', context,
    payload: {settings: {monitor: 'DP-1', workspace: 10}}})});
  assert.equal(elements.monitor.value, 'DP-1');
  assert.equal(String(elements.workspace.value), '10');
  assert.equal(elements.save.disabled, false);
  assert.notEqual(elements.status.textContent, 'Target saved.');
});

test('inspector has an explicit dark surface and readable text/button contrast', async () => {
  const css = await fs.readFile(new URL('../opendeck/codefriendly.streamdeck.sdPlugin/inspector.css', import.meta.url), 'utf8');
  assert.match(css, /background: #262626/);
  const luminance = hex => {
    const channels = hex.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  for (const [foreground, background] of [['f5f5f5', '262626'], ['c4c4c4', '262626'], ['c4c4c4', '333333'], ['101418', '68d5b5'], ['f7b8af', '262626']]) {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    assert.ok((values[0] + .05) / (values[1] + .05) >= 4.5);
  }
});

test('invalid inspector registration cannot connect or request another action settings', async () => {
  const {sockets, scope, context, action} = await inspector();
  scope.window.connectOpenActionSocket(57116, 'other-context', 'registerPropertyInspector', '{}', JSON.stringify(action));
  assert.equal(sockets.length, 0);
  scope.window.connectOpenActionSocket(70000, context, 'registerPropertyInspector', '{}', JSON.stringify(action));
  assert.equal(sockets.length, 0);
});
