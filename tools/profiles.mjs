import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ACTION, PLUGIN, connector} from '../opendeck/codefriendly.streamdeck.sdPlugin/model.mjs';

const packageDir = new URL('../opendeck/codefriendly.streamdeck.sdPlugin/', import.meta.url);
const manifest = JSON.parse(await fs.readFile(new URL('manifest.json', packageDir), 'utf8'));
const definition = manifest.Actions.find(action => action.UUID === ACTION);
const resource = filename => `plugins/${PLUGIN}/${filename}`;

function nativeState(state, title) {
  return {image: resource(state.Image), image_override: null, image_scale: 100,
    background_colour: state.BackgroundColour, name: state.Name || '', text: title,
    text_override: null, show: true, colour: state.TitleColor, stroke_colour: '#000000',
    alignment: 'middle', family: 'Liberation Sans', style: 'Regular', size: state.FontSize,
    stroke_size: 0, underline: false};
}

function workspaceAction() {
  return {name: definition.Name, uuid: ACTION, plugin: PLUGIN, tooltip: definition.Tooltip,
    icon: resource(definition.Icon), disable_automatic_states: true, visible_in_action_list: true,
    supported_in_multi_actions: false, property_inspector: resource(definition.PropertyInspectorPath),
    controllers: ['Keypad'], encoder: null, states: definition.States.map(state => nativeState(state, '?'))};
}

function navigation(button, profile, direction) {
  const state = nativeState({...definition.States[1], Name: 'Switch profile', Image: `chevron-${direction}.svg`}, '');
  state.image_scale = 75;
  const action = {name: 'Switch Profile', uuid: 'com.amansprojects.starterpack.switchprofile',
    plugin: 'com.amansprojects.starterpack.sdPlugin', tooltip: 'Switch workspace profile',
    icon: resource('icon.svg'), disable_automatic_states: true, visible_in_action_list: true,
    supported_in_multi_actions: true,
    property_inspector: 'plugins/com.amansprojects.starterpack.sdPlugin/propertyInspector/switchProfile.html',
    controllers: ['Keypad'], encoder: null, states: [structuredClone(state)]};
  return {action, context: `Keypad.${button}.0`, states: [state], current_state: 0,
    settings: {profile}, children: null};
}

export function buildProfiles(upper, lower, group = 'Workspaces') {
  if (!connector(upper) || !connector(lower) || upper === lower) throw new Error('Choose two distinct monitor connectors');
  if (typeof group !== 'string' || group !== group.trim() || !/^[A-Za-z0-9_ ][A-Za-z0-9_ ]{0,47}$/.test(group))
    throw new Error('Profile group must contain 1–48 letters, digits, spaces or underscores');
  const names = ['1 to 5', '6 to 10'];
  return new Map(names.map((name, page) => {
    const keys = Array(15).fill(null);
    for (const [monitor, firstButton] of [[upper, 0], [lower, 10]]) {
      for (let column = 0; column < 5; column++) {
        const button = firstButton + column;
        const workspace = page * 5 + column + 1;
        keys[button] = {action: workspaceAction(), context: `Keypad.${button}.0`,
          states: definition.States.map(state => nativeState(state, String(workspace))),
          current_state: 0, settings: {monitor, workspace}, children: null};
      }
    }
    const button = page ? 5 : 9;
    keys[button] = navigation(button, `${group}/${names[page ? 0 : 1]}`, page ? 'left' : 'right');
    return [`${name}.json`, {keys, sliders: [], infobars: []}];
  }));
}

export async function writeProfiles(output, upper, lower, group = 'Workspaces') {
  const profiles = buildProfiles(upper, lower, group);
  const target = path.resolve(output);
  if (path.basename(target) !== group) throw new Error('Output directory name must match the profile group');
  // Exclusive directory creation prevents merges or replacement of existing profiles.
  await fs.mkdir(target, {mode: 0o700});
  for (const [filename, profile] of profiles) {
    await fs.writeFile(path.join(target, filename), JSON.stringify(profile, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  }
  return target;
}

export function parseArgs(argv) {
  const options = {group: 'Workspaces'};
  for (let index = 0; index < argv.length;) {
    const name = argv[index++];
    if (name === '--monitors' && !options.monitors) {
      options.monitors = [argv[index++], argv[index++]];
    } else if (name === '--output' && !options.output) options.output = argv[index++];
    else if (name === '--group' && !options.groupSet) { options.group = argv[index++]; options.groupSet = true; }
    else throw new Error('Expected --monitors UPPER LOWER --output NEW_DIRECTORY [--group NAME]');
  }
  if (!options.monitors || typeof options.output !== 'string' || !options.output) throw new Error('Supply --monitors and --output');
  buildProfiles(...options.monitors, options.group);
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const output = await writeProfiles(options.output, ...options.monitors, options.group);
    console.log(`Created two OpenDeck profiles in ${output}`);
  } catch (error) {
    console.error(error.code === 'EEXIST'
      ? 'Output already exists. Nothing was overwritten; choose a new profile group/directory.'
      : `Profile generation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
