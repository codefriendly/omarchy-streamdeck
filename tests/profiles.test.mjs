import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildProfiles, parseArgs, writeProfiles} from '../tools/profiles.mjs';
import {ACTION, PLUGIN, settings} from '../opendeck/codefriendly.streamdeck.sdPlugin/model.mjs';

test('two portable profiles cover slots 1–10 on both monitors', () => {
  const profiles = buildProfiles('HDMI-A-1', 'DP-1');
  assert.deepEqual([...profiles.keys()], ['1 to 5.json', '6 to 10.json']);
  [...profiles.values()].forEach((profile, page) => {
    assert.equal(profile.keys.length, 15);
    for (const [monitor, firstButton] of [['HDMI-A-1', 0], ['DP-1', 10]]) {
      for (let column = 0; column < 5; column++) {
        const button = firstButton + column, slot = page * 5 + column + 1;
        const instance = profile.keys[button];
        assert.equal(instance.action.uuid, ACTION);
        assert.equal(instance.action.plugin, PLUGIN);
        assert.equal(instance.context, `Keypad.${button}.0`);
        assert.deepEqual(settings(instance.settings), {monitor, workspace: slot});
        assert.equal(instance.states.length, 6);
        assert.equal(instance.action.states.length, 6);
        assert.equal(instance.states.every(state => state.text === String(slot)), true);
        for (let role = 0; role < 3; role++) {
          assert.equal(instance.states[role * 2].background_colour, instance.states[role * 2 + 1].background_colour);
          assert.notEqual(instance.states[role * 2].colour, instance.states[role * 2 + 1].colour);
        }
      }
    }
    assert.deepEqual(profile.sliders, []);
    assert.deepEqual(profile.infobars, []);
  });
});
test('native switch-profile arrows occupy only the requested middle-row positions', () => {
  const [first, second] = buildProfiles('HDMI-A-1', 'DP-1').values();
  for (const [profile, button, direction, destination] of [
    [first, 9, 'right', 'Workspaces/6 to 10'], [second, 5, 'left', 'Workspaces/1 to 5'],
  ]) {
    const arrow = profile.keys[button];
    assert.equal(arrow.action.uuid, 'com.amansprojects.starterpack.switchprofile');
    assert.equal(arrow.states[0].text, '');
    assert.equal(arrow.states[0].text_override, null);
    assert.equal(arrow.states[0].image_override, null);
    assert.equal(arrow.states[0].image, `plugins/${PLUGIN}/chevron-${direction}.svg`);
    assert.equal(arrow.action.states[0].image, arrow.states[0].image);
    assert.equal(arrow.states[0].image_scale, 75);
    assert.equal(arrow.action.states[0].image_scale, 75);
    assert.deepEqual(arrow.settings, {profile: destination});
    for (let middle = 5; middle < 10; middle++) if (middle !== button) assert.equal(profile.keys[middle], null);
  }
});
test('navigation SVGs are bundled and mirror the same bold chevron', async () => {
  const directory = new URL('../opendeck/codefriendly.streamdeck.sdPlugin/', import.meta.url);
  const left = await fs.readFile(new URL('chevron-left.svg', directory), 'utf8');
  const right = await fs.readFile(new URL('chevron-right.svg', directory), 'utf8');
  for (const svg of [left, right]) {
    assert.match(svg, /viewBox="-16 -16 288 288"/);
    assert.match(svg, /fill="#ffffff"/);
    assert.doesNotMatch(svg, /<(?:script|image|text)\b|\bhref=/i);
  }
  assert.match(left, /transform="translate\(256 0\) scale\(-1 1\)"/);
  assert.equal(left.match(/<path d="([^"]+)"/)[1], right.match(/<path d="([^"]+)"/)[1]);
  assert.match(await fs.readFile(new URL('LICENSE.phosphor', directory), 'utf8'), /MIT License/);
});

test('profile generation needs no previous device configuration', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'osd-profiles-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const output = path.join(directory, 'Workspaces');
  await writeProfiles(output, 'HDMI-A-1', 'DP-1');
  assert.deepEqual((await fs.readdir(output)).sort(), ['1 to 5.json', '6 to 10.json']);
  const before = await fs.readFile(path.join(output, '1 to 5.json'));
  await assert.rejects(writeProfiles(output, 'OTHER-1', 'OTHER-2'), {code: 'EEXIST'});
  assert.deepEqual(await fs.readFile(path.join(output, '1 to 5.json')), before);
  assert.equal((await fs.stat(output)).mode & 0o077, 0);
  assert.equal((await fs.stat(path.join(output, '1 to 5.json'))).mode & 0o077, 0);
});
test('existing profiles remain untouched and another group can be generated', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'osd-profiles-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  await fs.writeFile(path.join(directory, 'Gaming.json'), 'preserve me');
  await writeProfiles(path.join(directory, 'Desktop'), 'HDMI-A-1', 'DP-1', 'Desktop');
  assert.equal(await fs.readFile(path.join(directory, 'Gaming.json'), 'utf8'), 'preserve me');
  const profile = JSON.parse(await fs.readFile(path.join(directory, 'Desktop', '1 to 5.json')));
  assert.equal(profile.keys[9].settings.profile, 'Desktop/6 to 10');
});
test('invalid connectors, groups and destinations fail before creating files', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'osd-profiles-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  for (const args of [['HDMI-A-1;sh', 'DP-1'], ['DP-1', 'DP-1'], ['DP-1', 'HDMI-A-1', '../Bad'], ['DP-1', 'HDMI-A-1', ' Bad']])
    assert.throws(() => buildProfiles(...args));
  await assert.rejects(writeProfiles(path.join(directory, 'Wrong'), 'HDMI-A-1', 'DP-1'), /must match/);
  assert.deepEqual(await fs.readdir(directory), []);
  const args = parseArgs(['--monitors', 'HDMI-A-1', 'DP-1', '--output', '/tmp/Workspaces']);
  assert.deepEqual(args.monitors, ['HDMI-A-1', 'DP-1']);
  assert.throws(() => parseArgs(['--monitors', 'HDMI-A-1', 'DP-1']));
});
