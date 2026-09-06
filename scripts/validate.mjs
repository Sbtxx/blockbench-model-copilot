import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const pluginPath = path.join(root, 'plugins', 'blockbench_model_copilot', 'blockbench_model_copilot.js');

if (!fs.existsSync(pluginPath)) {
    console.error(`Falta el archivo del plugin: ${pluginPath}`);
    process.exit(1);
}

const source = fs.readFileSync(pluginPath, 'utf8');

const required = [
    "Plugin.register(PLUGIN_ID",
    "const PLUGIN_ID = 'blockbench_model_copilot'",
    "title: 'Mikonode'",
    "const VERSION = '0.3.0'",
    "min_version: '4.8.0'",
    "tags: ['Minecraft', 'Utility', 'AI']",
    "repository: 'https://github.com/Sbtxx/blockbench-model-copilot'",
    'function validateBlueprint',
    'function applyBlueprint',
    'async function callAi',
    'function openReferencePicker',
    'function makeReferenceDataUrl',
    "provider: 'openai_responses'",
    'onload() {',
    'onunload() {'
];

const missing = required.filter(fragment => !source.includes(fragment));
if (missing.length) {
    console.error('Falló la validación del plugin:');
    for (const item of missing) console.error(`- ${item}`);
    process.exit(1);
}

const check = spawnSync(process.execPath, ['--check', pluginPath], { encoding: 'utf8' });
if (check.status !== 0) {
    console.error('Falló la comprobación de sintaxis de Node.js:');
    console.error(check.stderr || check.stdout || 'Error desconocido');
    process.exit(check.status || 1);
}

console.log('La metadata y la sintaxis del plugin son válidas.');
console.log(`Plugin: ${pluginPath}`);
console.log('Versión: 0.3.0');
console.log(`Tamaño: ${source.length} caracteres`);
