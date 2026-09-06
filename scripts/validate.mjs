import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pluginPath = path.join(root, 'plugins', 'blockbench_model_copilot', 'blockbench_model_copilot.js');

if (!fs.existsSync(pluginPath)) {
    console.error(`Missing plugin file: ${pluginPath}`);
    process.exit(1);
}

const source = fs.readFileSync(pluginPath, 'utf8');

const required = [
    "Plugin.register('blockbench_model_copilot'",
    "version: '0.2.0'",
    "min_version: '5.0.0'",
    "tags: ['Minecraft', 'Utility']",
    "repository: 'https://github.com/Sbtxx/blockbench-model-copilot'",
    'function validateBlueprint',
    'function applyBlueprint',
    'function callAi',
    'function openReferencePicker',
    'onload() {',
    'onunload() {'
];

const missing = required.filter(fragment => !source.includes(fragment));
if (missing.length) {
    console.error('Plugin validation failed:');
    for (const item of missing) console.error(`- ${item}`);
    process.exit(1);
}

console.log('Plugin metadata and structure look valid.');
console.log(`Plugin: ${pluginPath}`);
console.log(`Size: ${source.length} characters`);
