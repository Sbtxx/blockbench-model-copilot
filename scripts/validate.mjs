import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const pluginPath = path.join(root, 'plugins', 'blockbench_model_copilot', 'blockbench_model_copilot.js');
const packagePath = path.join(root, 'package.json');

if (!fs.existsSync(pluginPath)) {
    console.error(`Falta el archivo del plugin: ${pluginPath}`);
    process.exit(1);
}

if (!fs.existsSync(packagePath)) {
    console.error(`Falta package.json: ${packagePath}`);
    process.exit(1);
}

const source = fs.readFileSync(pluginPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

const required = [
    "Plugin.register('blockbench_model_copilot'",
    "const PLUGIN_ID = 'blockbench_model_copilot'",
    "title: 'Mikonode'",
    "min_version: '4.8.0'",
    "tags: ['Minecraft', 'Utility', 'AI']",
    "repository: 'https://github.com/Sbtxx/blockbench-model-copilot'",
    'function validateBlueprint',
    'function applyBlueprint',
    'async function callAi',
    'function openReferencePicker',
    'function makeReferenceDataUrl',
    "provider: 'openai_responses'",
    'const operations = [',
    'operaciones: operations',
    'onload() {',
    'onunload() {'
];

const missing = required.filter(fragment => !source.includes(fragment));
if (missing.length) {
    console.error('Falló la validación del plugin:');
    for (const item of missing) console.error(`- Falta: ${item}`);
    process.exit(1);
}

const versionMatch = source.match(/const VERSION = '([^']+)'/);
if (!versionMatch) {
    console.error('No se pudo detectar VERSION en el plugin.');
    process.exit(1);
}

const pluginVersion = versionMatch[1];
if (packageJson.version !== pluginVersion) {
    console.error(`Versiones desalineadas: plugin=${pluginVersion}, package.json=${packageJson.version}`);
    process.exit(1);
}

const forbidden = [
    { label: 'eval()', pattern: /\beval\s*\(/ },
    { label: 'new Function()', pattern: /\bnew\s+Function\s*\(/ },
    { label: 'API key de OpenAI hardcodeada', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ }
];

const unsafe = forbidden.filter(item => item.pattern.test(source));
if (unsafe.length) {
    console.error('Falló la revisión de seguridad del plugin:');
    for (const item of unsafe) console.error(`- No se permite: ${item.label}`);
    process.exit(1);
}

if (/\boperaciones\s*\}\s*\)/.test(source)) {
    console.error('Se detectó un posible error de referencia: usar "operaciones" sin asignación de "operations".');
    process.exit(1);
}

const check = spawnSync(process.execPath, ['--check', pluginPath], { encoding: 'utf8' });
if (check.status !== 0) {
    console.error('Falló la comprobación de sintaxis de Node.js:');
    console.error(check.stderr || check.stdout || 'Error desconocido');
    process.exit(check.status || 1);
}

console.log('La metadata, la seguridad básica y la sintaxis del plugin son válidas.');
console.log(`Plugin: ${pluginPath}`);
console.log(`Versión: ${pluginVersion}`);
console.log(`Tamaño: ${source.length} caracteres`);
