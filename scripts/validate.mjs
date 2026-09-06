import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pluginPath = path.join(root, 'plugins', 'blockbench_model_copilot', 'blockbench_model_copilot.js');

if (!fs.existsSync(pluginPath)) {
    console.error(`Falta el archivo del plugin: ${pluginPath}`);
    process.exit(1);
}

const source = fs.readFileSync(pluginPath, 'utf8');

const required = [
    "Plugin.register('blockbench_model_copilot'",
    "title: 'Mikonode'",
    "version: '0.2.1'",
    "min_version: '4.8.0'",
    "tags: ['Minecraft', 'Utility', 'AI']",
    "repository: 'https://github.com/Sbtxx/blockbench-model-copilot'",
    'function validateBlueprint',
    'function applyBlueprint',
    'async function callAi',
    'function openReferencePicker',
    'Configuración de Mikonode',
    'onload() {',
    'onunload() {'
];

const missing = required.filter(fragment => !source.includes(fragment));
if (missing.length) {
    console.error('Falló la validación del plugin:');
    for (const item of missing) console.error(`- ${item}`);
    process.exit(1);
}

let braces = 0;
let quote = null;
let escaped = false;
for (const char of source) {
    if (escaped) {
        escaped = false;
        continue;
    }
    if (char === '\\') {
        escaped = true;
        continue;
    }
    if (quote) {
        if (char === quote) quote = null;
        continue;
    }
    if (char === '"' || char === "'" || char === '`') {
        quote = char;
        continue;
    }
    if (char === '{') braces++;
    if (char === '}') braces--;
}

if (braces !== 0 || quote) {
    console.error(`Falló la comprobación de sintaxis (${braces} llaves pendientes, cadena=${quote ?? 'ninguna'}).`);
    process.exit(1);
}

console.log('La metadata y la estructura del plugin parecen válidas.');
console.log(`Plugin: ${pluginPath}`);
console.log(`Tamaño: ${source.length} caracteres`);
