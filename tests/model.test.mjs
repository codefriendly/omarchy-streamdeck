import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {ACTION, ActionEngine, context, focusCommand, settings, snapshot, stateFor} from '../opendeck/codefriendly.streamdeck.sdPlugin/model.mjs';
import {parseArgs} from '../opendeck/codefriendly.streamdeck.sdPlugin/plugin.mjs';

const target = {monitor: 'HDMI-A-1', workspace: 2};
const id = 'sd-example.Workspaces/1 to 5.Keypad.1.0';
const desktop = () => ({version: 1, monitors: [
  {name: 'HDMI-A-1', workspace: 2, focused: true},
  {name: 'DP-1', workspace: 12, focused: false},
], blocks: {'HDMI-A-1': 0, 'DP-1': 1}, counts: {2: 1, 12: 0}});
const event = (name, config = target, actionContext = id) => ({event: name, action: ACTION,
  context: actionContext, payload: {settings: config, state: 0}});
function engine() {
  const messages = [], commands = [];
  const action = new ActionEngine(message => { messages.push(message); return true; }, command => { commands.push(command); return true; });
  return {action, messages, commands};
}

test('six native states distinguish focus, visibility and occupancy', () => {
  const value = snapshot(desktop());
  assert.equal(stateFor(value, target), 5);
  value.counts[2] = 0;
  assert.equal(stateFor(value, target), 4);
  assert.equal(stateFor(value, {monitor: 'DP-1', workspace: 2}), 2);
  value.counts[12] = 1;
  assert.equal(stateFor(value, {monitor: 'DP-1', workspace: 2}), 3);
  assert.equal(stateFor(value, {monitor: 'HDMI-A-1', workspace: 6}), 0);
  value.counts[6] = 2;
  assert.equal(stateFor(value, {monitor: 'HDMI-A-1', workspace: 6}), 1);
});
test('missing monitors/mappings and special/guest workspaces never fake focus', () => {
  const value = snapshot(desktop());
  assert.equal(stateFor(null, target), 0);
  assert.equal(stateFor(value, null), 0);
  assert.equal(stateFor(value, {monitor: 'missing', workspace: 2}), 0);
  value.blocks = {};
  assert.equal(stateFor(value, target), 0);
  value.blocks = {'HDMI-A-1': 0};
  value.monitors[0].workspace = -98;
  assert.equal(stateFor(value, target), 1);
  value.monitors[0].workspace = 12;
  assert.equal(stateFor(value, target), 1);
});
test('snapshot parser bounds collections and rejects malformed values', () => {
  for (const change of [d => d.version = 2, d => d.monitors[0].focused = 'yes', d => d.monitors.push(d.monitors[0]),
    d => d.counts[-98] = 1, d => d.counts[2] = 99999, d => d.blocks['HDMI-A-1'] = -1,
    d => d.monitors[0].name = 'DP-1;sh', d => d.blocks = [], d => d.counts = Array(5000)]) {
    const value = desktop(); change(value); assert.throws(() => snapshot(value));
  }
  const value = desktop(); value.blocks.constructor = 1;
  const parsed = snapshot(value);
  assert.equal(Object.getPrototypeOf(parsed.blocks), null);
  assert.equal(parsed.blocks.constructor, 1);
});
test('workspace press is one bounded argument-array dispatch', () => {
  assert.deepEqual(focusCommand({monitor: 'DP-1', workspace: 10}),
    ['hyprctl', ['dispatch', 'o.workspaces.focus(10, "DP-1")']]);
  for (const invalid of [{monitor: 'DP-1; touch /tmp/no', workspace: 1}, {monitor: 'DP-1', workspace: '1'},
    {monitor: 'DP-1', workspace: 11}, {monitor: '../bad', workspace: 1}]) {
    assert.equal(settings(invalid), null); assert.throws(() => focusCommand(invalid));
  }
  assert.equal(context(id), true);
  assert.equal(context('sd-example.Profile.Keypad.256.0'), false);
  assert.equal(context('sd-example.Profile.Keypad.0.1'), false);
  assert.equal(context('sd-example.Profile.Keypad.0.0\n'), false);
});
test('engine updates only its visible actions and sends no repeated states', () => {
  const {action, messages, commands} = engine();
  action.receiveDesktop(desktop());
  action.receive(event('willAppear'));
  assert.deepEqual(messages.map(message => message.event), ['setTitle', 'setState']);
  assert.equal(messages[1].payload.state, 5);
  action.receiveDesktop(desktop());
  assert.equal(messages.length, 2);
  action.receive(event('keyDown'));
  assert.equal(commands.length, 0);
  action.receive(event('keyUp'));
  assert.deepEqual(commands, [focusCommand(target)]);
  action.receive(event('willDisappear'));
  action.receive(event('keyUp'));
  action.receiveDesktop(desktop());
  assert.equal(commands.length, 1);
  assert.equal(action.actions.size, 0);
});
test('occupancy changes and invalidation update styling without executing actions', () => {
  const {action, messages, commands} = engine();
  action.receive(event('willAppear'));
  action.receiveDesktop(desktop());
  const value = desktop(); value.counts[2] = 0;
  action.receiveDesktop(value);
  assert.equal(messages.at(-1).payload.state, 4);
  action.invalidate();
  assert.equal(messages.at(-1).payload.state, 0);
  action.receiveDesktop(desktop());
  assert.equal(messages.at(-1).payload.state, 5);
  assert.equal(commands.length, 0);
});
test('unconfigured or foreign actions cannot run a command', () => {
  const {action, messages, commands} = engine();
  action.receive({...event('willAppear'), action: 'another.plugin'});
  action.receive(event('keyUp'));
  assert.equal(action.actions.size, 0);
  action.receive(event('willAppear', {}));
  assert.equal(messages.at(-1).payload.title, '?');
  action.receive(event('keyUp', {}));
  assert.equal(messages.at(-1).event, 'showAlert');
  assert.equal(commands.length, 0);
});
test('settings and transport changes refresh labels and retry unsent updates', () => {
  const messages = [];
  let available = false;
  const action = new ActionEngine(message => { if (!available) return false; messages.push(message); return true; }, () => true);
  action.receiveDesktop(desktop()); action.receive(event('willAppear'));
  assert.equal(messages.length, 0);
  available = true; action.refresh();
  assert.equal(messages.at(-1).payload.state, 5);
  action.receive(event('didReceiveSettings', {monitor: 'HDMI-A-1', workspace: 10}));
  assert.equal(messages.findLast(message => message.event === 'setTitle').payload.title, '10');
  const count = messages.length;
  action.resetTransport(); action.refresh();
  assert.equal(messages.length, count + 2);
});
test('host registration arguments accept only the expected plugin and local port', () => {
  const argv = ['-port', '57116', '-pluginUUID', 'codefriendly.streamdeck.sdPlugin', '-registerEvent', 'registerPlugin', '-info', '{}'];
  assert.deepEqual(parseArgs(argv), {port: 57116});
  for (const change of [a => a[1] = '0', a => a[1] = '70000', a => a[3] = 'other', a => a[5] = 'registerPropertyInspector', a => a.push('extra')]) {
    const invalid = [...argv]; change(invalid); assert.throws(() => parseArgs(invalid));
  }
});
test('QML block parser emits the mapping expected by the companion', async () => {
  const scope = vm.createContext({});
  vm.runInContext(await fs.readFile(new URL('../DesktopState.js', import.meta.url), 'utf8'), scope);
  const blocks = scope.parseBlocks('0\tHDMI-A-1\tidentity\n1\tDP-1\tidentity\n2\t\tunplugged\nno\tbad\tbad\n');
  assert.deepEqual(JSON.parse(JSON.stringify(blocks)), desktop().blocks);
  assert.equal(Object.keys(scope.parseBlocks('x'.repeat(65537))).length, 0);
});
