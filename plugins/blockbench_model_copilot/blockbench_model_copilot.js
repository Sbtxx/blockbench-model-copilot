/// <reference types="blockbench-types" />

(function () {
    'use strict';

    const PLUGIN_ID = 'blockbench_model_copilot';
    const VERSION = '0.2.2';
    const STORAGE_KEY = 'mikonode_ai_config_v2';
    const MAX_OPERATIONS = 100;
    const MAX_PROMPT = 12000;

    let panel = null;
    let openAction = null;
    let settingsAction = null;
    let selectionListener = null;
    let styleSheet = null;
    let imageInput = null;
    let referenceDataUrl = null;
    let referenceName = null;

    const state = {
        busy: false,
        prompt: '',
        lastPlan: null,
        messages: [
            { role: 'assistant', text: 'Hola. Soy Mikonode. Describe un modelo, agrega un boceto o dime qué quieres cambiar.' }
        ]
    };

    const defaultConfig = {
        enabled: false,
        endpoint: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-4o-mini',
        apiKey: '',
        timeoutMs: 45000
    };

    function getConfig() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? { ...defaultConfig, ...JSON.parse(raw) } : { ...defaultConfig };
        } catch {
            return { ...defaultConfig };
        }
    }

    function saveConfig(config) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...defaultConfig, ...config }));
    }

    function aiConfigured() {
        const config = getConfig();
        return Boolean(config.enabled && config.endpoint && config.model && config.apiKey);
    }

    function text(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
        })[char]);
    }

    function vec(value, fallback = [0, 0, 0], min = -64, max = 64) {
        if (!Array.isArray(value) || value.length !== 3) return fallback.slice();
        return value.map(v => {
            const n = Number(v);
            return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback[0];
        });
    }

    function projectSummary(includeElements = true) {
        const summary = {
            proyecto: typeof Project !== 'undefined' && Project ? (Project.name || 'Proyecto sin nombre') : 'Sin proyecto',
            formato: typeof Format !== 'undefined' && Format ? (Format.id || Format.name || 'Desconocido') : 'Desconocido',
            cubos: typeof Cube !== 'undefined' && Array.isArray(Cube.all) ? Cube.all.length : 0,
            grupos: typeof Group !== 'undefined' && Array.isArray(Group.all) ? Group.all.length : 0,
            mallas: typeof Mesh !== 'undefined' && Array.isArray(Mesh.all) ? Mesh.all.length : 0,
            texturas: typeof Texture !== 'undefined' && Array.isArray(Texture.all) ? Texture.all.length : 0,
            animaciones: typeof Animation !== 'undefined' && Array.isArray(Animation.all) ? Animation.all.length : 0,
            seleccionados: typeof OutlinerElement !== 'undefined' && Array.isArray(OutlinerElement.selected) ? OutlinerElement.selected.length : 0
        };

        if (!includeElements) return summary;
        summary.elementos = [];
        if (typeof Outliner !== 'undefined' && Array.isArray(Outliner.elements)) {
            for (const element of Outliner.elements.slice(0, 100)) {
                summary.elementos.push({
                    tipo: element.type || 'element',
                    nombre: element.name || 'sin_nombre',
                    uuid: element.uuid || null,
                    desde: Array.isArray(element.from) ? element.from.slice() : undefined,
                    hasta: Array.isArray(element.to) ? element.to.slice() : undefined,
                    origen: Array.isArray(element.origin) ? element.origin.slice() : undefined,
                    rotacion: Array.isArray(element.rotation) ? element.rotation.slice() : undefined
                });
            }
        }
        return summary;
    }

    function addMessage(role, message) {
        state.messages.push({ role, text: String(message) });
        if (state.messages.length > 40) state.messages.shift();
        renderPanel();
    }

    function setBusy(value) {
        state.busy = Boolean(value);
        renderPanel();
    }

    function systemPrompt(mode) {
        const common = [
            'Eres Mikonode, un asistente de modelado 3D dentro de Blockbench.',
            'Ayuda a crear modelos editables con estética Minecraft/low-poly.',
            'Nunca devuelvas JavaScript ejecutable.',
            'Usa exclusivamente las operaciones permitidas.',
            'Mantén coordenadas entre -64 y 64.',
            'Prioriza silueta y proporciones antes que detalles.'
        ];
        if (mode === 'plan') {
            common.push(
                'Devuelve SOLO JSON válido.',
                'Formato: {"titulo":string,"resumen":string,"estilo":string,"operaciones":[...]}',
                'crear_grupo={"tipo":"crear_grupo","id":string,"nombre":string,"parentId":string|null,"origen":[x,y,z]}',
                'crear_cubo={"tipo":"crear_cubo","id":string,"nombre":string,"parentId":string|null,"desde":[x,y,z],"hasta":[x,y,z],"origen":[x,y,z],"rotacion":[x,y,z]}',
                'mover={"tipo":"mover","objetivo":string,"delta":[x,y,z]}',
                'escalar={"tipo":"escalar","objetivo":string,"escala":[x,y,z]}',
                'renombrar={"tipo":"renombrar","objetivo":string,"nombre":string}',
                'eliminar={"tipo":"eliminar","objetivo":string}',
                'No superes 100 operaciones.'
            );
        } else if (mode === 'review') {
            common.push(
                'Devuelve SOLO JSON válido.',
                'Formato: {"puntuacion":0,"fortalezas":[""],"problemas":[{"severidad":"baja|media|alta","mensaje":""}],"sugerencias":[""]}'
            );
        } else {
            common.push('Devuelve Markdown breve y práctico. Explica los pasos para modelar desde la silueta hasta los detalles.');
        }
        return common.join('\n');
    }

    function cleanJson(raw) {
        const value = String(raw || '').trim();
        return value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    }

    function parseJson(raw) {
        const value = cleanJson(raw);
        try {
            return JSON.parse(value);
        } catch {
            const start = value.indexOf('{');
            const end = value.lastIndexOf('}');
            if (start < 0 || end <= start) throw new Error('La IA no devolvió un JSON válido.');
            return JSON.parse(value.slice(start, end + 1));
        }
    }

    function normalizeOperation(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const type = String(raw.tipo || raw.type || '').toLowerCase();
        if (!type) return null;
        return {
            ...raw,
            type,
            id: raw.id ? String(raw.id).slice(0, 64) : undefined,
            nombre: String(raw.nombre || raw.name || 'pieza').slice(0, 64).replace(/[^\w\- áéíóúÁÉÍÓÚñÑ]/g, '').trim() || 'pieza',
            objetivo: raw.objetivo || raw.target ? String(raw.objetivo || raw.target).slice(0, 80) : undefined,
            parentId: raw.parentId ? String(raw.parentId).slice(0, 64) : null,
            origen: vec(raw.origen || raw.origin),
            desde: vec(raw.desde || raw.from),
            hasta: vec(raw.hasta || raw.to),
            rotacion: vec(raw.rotacion || raw.rotation),
            delta: vec(raw.delta, [0, 0, 0], -32, 32),
            escala: vec(raw.escala || raw.scale, [1, 1, 1], 0.1, 4)
        };
    }

    function validateBlueprint(data) {
        if (!data || typeof data !== 'object') throw new Error('El plan no es válido.');
        if (!Array.isArray(data.operaciones)) throw new Error('El plan no contiene operaciones.');
        if (data.operaciones.length > MAX_OPERATIONS) throw new Error(`El plan supera ${MAX_OPERATIONS} operaciones.`);
        const allowed = new Set(['crear_grupo', 'crear_cubo', 'mover', 'escalar', 'renombrar', 'eliminar']);
        const ops = data.operaciones.map(normalizeOperation).filter(Boolean);
        for (const op of ops) {
            if (!allowed.has(op.type)) throw new Error(`Operación no permitida: ${op.type}`);
            if (op.type === 'crear_cubo' && (!op.desde || !op.hasta)) throw new Error('Un cubo no tiene límites válidos.');
        }
        return {
            titulo: String(data.titulo || data.title || 'Plan de modelo').slice(0, 120),
            resumen: String(data.resumen || data.summary || '').slice(0, 1000),
            estilo: String(data.estilo || data.style || '').slice(0, 200),
            operaciones: ops
        };
    }

    function findElement(identifier) {
        if (!identifier) return null;
        const key = String(identifier);
        if (typeof Cube !== 'undefined' && Array.isArray(Cube.all)) {
            const cube = Cube.all.find(c => c.uuid === key || c.name === key);
            if (cube) return cube;
        }
        if (typeof Group !== 'undefined' && Array.isArray(Group.all)) {
            const group = Group.all.find(g => g.uuid === key || g.name === key);
            if (group) return group;
        }
        return null;
    }

    function applyBlueprint(blueprint) {
        const created = [];
        const groups = new Map();
        Undo.initEdit({ elements: [], outliner: true, selection: true });
        try {
            for (const op of blueprint.operaciones.filter(o => o.type === 'crear_grupo')) {
                const group = new Group({
                    name: op.nombre,
                    origin: op.origen,
                    rotation: op.rotacion
                }).init();
                const parent = op.parentId ? groups.get(op.parentId) : null;
                if (parent && typeof group.addTo === 'function') group.addTo(parent);
                groups.set(op.id || op.nombre, group);
                created.push(group);
            }

            for (const op of blueprint.operaciones.filter(o => o.type === 'crear_cubo')) {
                const cube = new Cube({
                    name: op.nombre,
                    from: op.desde,
                    to: op.hasta,
                    origin: op.origen,
                    rotation: op.rotacion
                }).init();
                const parent = op.parentId ? groups.get(op.parentId) : null;
                if (parent && typeof cube.addTo === 'function') cube.addTo(parent);
                created.push(cube);
            }

            for (const op of blueprint.operaciones.filter(o => !o.type.startsWith('crear_'))) {
                const target = findElement(op.objetivo);
                if (!target) continue;
                if (op.type === 'mover') {
                    if (Array.isArray(target.from) && Array.isArray(target.to)) {
                        for (let i = 0; i < 3; i++) {
                            target.from[i] += op.delta[i];
                            target.to[i] += op.delta[i];
                        }
                    }
                    if (Array.isArray(target.origin)) {
                        for (let i = 0; i < 3; i++) target.origin[i] += op.delta[i];
                    }
                } else if (op.type === 'escalar' && Array.isArray(target.from) && Array.isArray(target.to)) {
                    const center = target.from.map((v, i) => (v + target.to[i]) / 2);
                    const half = target.from.map((v, i) => ((target.to[i] - v) * op.escala[i]) / 2);
                    target.from = center.map((v, i) => v - half[i]);
                    target.to = center.map((v, i) => v + half[i]);
                } else if (op.type === 'renombrar') {
                    target.name = op.nombre;
                } else if (op.type === 'eliminar' && typeof target.remove === 'function') {
                    target.remove();
                }
            }

            if (typeof Canvas !== 'undefined' && typeof Canvas.updateAll === 'function') Canvas.updateAll();
            Undo.finishEdit(`Mikonode: ${blueprint.titulo}`);
            return created;
        } catch (error) {
            try { Undo.cancelEdit(); } catch {}
            throw error;
        }
    }

    function localBlueprint(prompt) {
        const value = String(prompt || '').toLowerCase();
        let kind = 'objeto';
        if (/espada|sword/.test(value)) kind = 'espada';
        else if (/hacha|axe/.test(value)) kind = 'hacha';
        else if (/martillo|hammer/.test(value)) kind = 'martillo';
        else if (/rifle|pistola|arma|gun|weapon/.test(value)) kind = 'arma';
        else if (/casco|helmet/.test(value)) kind = 'casco';
        else if (/dragón|dragon/.test(value)) kind = 'dragon';

        const ops = [
            { type: 'crear_grupo', id: 'root', nombre: `mikonode_${kind}`, parentId: null, origen: [0, 0, 0], rotacion: [0, 0, 0] }
        ];
        const addCube = (id, name, from, to, origin = [0, 0, 0]) => ops.push({
            type: 'crear_cubo', id, nombre: name, parentId: 'root', desde: from, hasta: to, origen: origin, rotacion: [0, 0, 0]
        });

        if (kind === 'espada') {
            addCube('mango', 'mango', [-1, -6, -1], [1, 3, 1], [0, -4, 0]);
            addCube('guardia', 'guardia', [-4, 2, -1], [4, 4, 1], [0, 3, 0]);
            addCube('hoja', 'hoja', [-2, 4, -1], [2, 20, 1], [0, 4, 0]);
            addCube('punta', 'punta', [-1, 20, -0.7], [1, 22, 0.7], [0, 20, 0]);
        } else if (kind === 'arma') {
            addCube('cuerpo', 'cuerpo', [-5, -2, -2], [5, 6, 2], [0, 0, 0]);
            addCube('cañon', 'cañon', [-1.5, 6, -1.5], [1.5, 20, 1.5], [0, 6, 0]);
            addCube('empuñadura', 'empuñadura', [-3, -8, -1.5], [3, 0, 1.5], [0, -4, 0]);
            addCube('culata', 'culata', [-5, -7, -2], [-1, -1, 2], [-3, -5, 0]);
        } else if (kind === 'dragon') {
            addCube('cuerpo', 'cuerpo', [-6, 0, -4], [6, 10, 4], [0, 4, 0]);
            addCube('cabeza', 'cabeza', [-5, 9, -5], [5, 16, 5], [0, 12, 0]);
            addCube('hocico', 'hocico', [-3, 11, -9], [3, 16, -5], [0, 13, -7]);
            addCube('ala_izq', 'ala_izq', [5, 6, -1], [13, 15, 1], [6, 8, 0]);
            addCube('ala_der', 'ala_der', [-13, 6, -1], [-5, 15, 1], [-6, 8, 0]);
            addCube('cola', 'cola', [-3, -8, -2], [3, 0, 2], [0, -5, 1]);
        } else if (kind === 'casco') {
            addCube('cascara', 'cascara', [-8, 8, -6], [8, 24, 6], [0, 16, 0]);
            addCube('visor', 'visor', [-6, 13, -9], [6, 16, -7], [0, 14, -8]);
        } else if (kind === 'hacha') {
            addCube('mango', 'mango', [-1, -8, -1], [1, 8, 1]);
            addCube('cabeza', 'cabeza', [0, 4, -1], [7, 10, 3], [1, 7, 0]);
        } else if (kind === 'martillo') {
            addCube('mango', 'mango', [-1, -8, -1], [1, 8, 1]);
            addCube('cabeza', 'cabeza', [-5, 7, -2], [5, 12, 2], [0, 9, 0]);
        } else {
            addCube('cuerpo', 'cuerpo', [-5, 0, -3], [5, 10, 3], [0, 5, 0]);
            addCube('superior', 'superior', [-4, 10, -2], [4, 18, 2], [0, 10, 0]);
            addCube('detalle', 'detalle', [-2, 18, -1], [2, 22, 1], [0, 18, 0]);
        }

        return {
            titulo: `Mikonode — ${kind}`,
            resumen: 'Plan local de respaldo listo para aplicar en Blockbench.',
            estilo: 'Minecraft / low-poly',
            operaciones: ops
        };
    }

    async function callAi(mode, prompt) {
        const config = getConfig();
        if (!aiConfigured()) throw new Error('La IA no está configurada. Abre Herramientas → Configuración de Mikonode.');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.max(5000, Number(config.timeoutMs) || 45000));
        try {
            const userPayload = {
                texto: String(prompt || '').slice(0, MAX_PROMPT),
                referencia: referenceName || null,
                proyecto: projectSummary(true)
            };

            if (referenceDataUrl && mode === 'plan') userPayload.imagen_base64 = referenceDataUrl;

            const response = await fetch(config.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`
                },
                body: JSON.stringify({
                    model: config.model,
                    temperature: 0.2,
                    messages: [
                        { role: 'system', content: systemPrompt(mode) },
                        { role: 'user', content: JSON.stringify(userPayload) }
                    ]
                }),
                signal: controller.signal
            });

            const raw = await response.text();
            if (!response.ok) throw new Error(`La API respondió ${response.status}: ${raw.slice(0, 300)}`);
            const payload = JSON.parse(raw);
            const result = payload?.choices?.[0]?.message?.content;
            if (!result) throw new Error('La IA no devolvió contenido.');
            return result;
        } finally {
            clearTimeout(timeout);
        }
    }

    function localReview() {
        const summary = projectSummary(false);
        const problems = [];
        const suggestions = [];
        if (summary.cubos === 0) {
            problems.push({ severidad: 'media', mensaje: 'El proyecto todavía no tiene cubos.' });
            suggestions.push('Crea primero una silueta base.');
        }
        if (summary.cubos > 0 && summary.grupos === 0) suggestions.push('Agrupa piezas relacionadas para facilitar la edición.');
        if (summary.texturas === 0 && summary.cubos > 0) suggestions.push('Añade una textura cuando la geometría principal esté lista.');
        if (summary.seleccionados === 0 && summary.cubos > 0) suggestions.push('Selecciona una pieza para recibir recomendaciones más específicas.');
        return {
            puntuacion: Math.max(0, 100 - problems.length * 25),
            fortalezas: summary.cubos > 0 ? ['La geometría es editable dentro de Blockbench.'] : [],
            problemas,
            sugerencias: suggestions
        };
    }

    function formatReview(review) {
        const score = review?.puntuacion ?? review?.score ?? 0;
        const strengths = review?.fortalezas || review?.strengths || [];
        const problems = review?.problemas || review?.issues || [];
        const suggestions = review?.sugerencias || review?.suggestions || [];
        return [
            `ANÁLISIS DEL MODELO — ${score}/100`,
            '',
            `Fortalezas:\n${strengths.length ? strengths.map(v => `• ${v}`).join('\n') : '• Ninguna detectada.'}`,
            '',
            `Problemas:\n${problems.length ? problems.map(v => `• ${v.mensaje || v.message}`).join('\n') : '• Ninguno detectado.'}`,
            '',
            `Sugerencias:\n${suggestions.length ? suggestions.map(v => `• ${v}`).join('\n') : '• El modelo va por buen camino.'}`
        ].join('\n');
    }

    async function handleAnalyze() {
        if (state.busy) return;
        setBusy(true);
        try {
            if (aiConfigured()) {
                const result = parseJson(await callAi('review', 'Analiza el modelo actual y dame fortalezas, problemas y sugerencias.'));
                addMessage('assistant', formatReview(result));
            } else {
                addMessage('assistant', formatReview(localReview()) + '\n\nConfigura una IA para obtener una revisión contextual más avanzada.');
            }
        } catch (error) {
            addMessage('assistant', `No pude completar el análisis: ${error.message || error}`);
        } finally {
            setBusy(false);
        }
    }

    async function handlePrompt(prompt) {
        const trimmed = String(prompt || '').trim();
        if (!trimmed || state.busy) return;
        state.prompt = '';
        addMessage('user', trimmed);
        setBusy(true);

        try {
            const lower = trimmed.toLowerCase();
            if (/^analiza$|analiza el modelo|revisa el modelo|^analyze$/.test(lower)) {
                await handleAnalyze();
                return;
            }
            if (/enséñame|ensename|teach me|cómo modelar|como modelar/.test(lower)) {
                if (aiConfigured()) addMessage('assistant', await callAi('teach', trimmed));
                else addMessage('assistant', 'Empieza por la silueta, continúa con las proporciones, después añade formas secundarias y finalmente detalles. Mantén grupos y nombres claros.');
                return;
            }

            let blueprint;
            if (aiConfigured()) {
                try {
                    blueprint = validateBlueprint(parseJson(await callAi('plan', trimmed)));
                } catch (error) {
                    addMessage('assistant', `La IA no produjo un plan válido (${error.message || error}). Usaré el generador local.`);
                }
            }
            if (!blueprint) blueprint = validateBlueprint(localBlueprint(trimmed));
            state.lastPlan = blueprint;
            addMessage('assistant', `${blueprint.titulo}\n\n${blueprint.resumen}\n\nOperaciones: ${blueprint.operaciones.length}\n\nPulsa «Aplicar plan» para crear el modelo.`);
        } catch (error) {
            addMessage('assistant', `Ocurrió un error: ${error.message || error}`);
        } finally {
            setBusy(false);
        }
    }

    function openReferencePicker() {
        if (!imageInput) return;
        imageInput.value = '';
        imageInput.click();
    }

    function openSettings() {
        const config = getConfig();
        const enabled = confirm(`Mikonode — configuración de IA\n\nIA: ${config.enabled ? 'ACTIVADA' : 'DESACTIVADA'}\n\n¿Quieres configurarla ahora?`);
        if (!enabled) return;
        const endpoint = prompt('Endpoint compatible con OpenAI:', config.endpoint) || config.endpoint;
        const model = prompt('Nombre del modelo:', config.model) || config.model;
        const apiKey = prompt('API key:', config.apiKey || '') || '';
        const timeout = prompt('Tiempo límite en milisegundos:', String(config.timeoutMs)) || String(config.timeoutMs);
        saveConfig({ enabled: true, endpoint, model, apiKey, timeoutMs: Number(timeout) || 45000 });
        addMessage('assistant', 'Configuración guardada localmente en Blockbench.');
    }

    function quick(kind) {
        const prompts = {
            sword: 'Crea una espada estilo Minecraft con empuñadura, guardia, hoja ancha y punta.',
            dragon: 'Crea un dragón estilo Minecraft con cuerpo, cabeza, cola y alas grandes.',
            weapon: 'Crea un arma futurista estilo Minecraft con cuerpo, cañón, empuñadura y culata.'
        };
        handlePrompt(prompts[kind] || 'Crea un modelo base estilo Minecraft.');
    }

    function panelHtml() {
        const summary = projectSummary(false);
        const status = aiConfigured() ? 'IA conectada' : 'Modo local';
        const reference = referenceName ? `Referencia: ${text(referenceName)}` : 'Sin referencia';
        const messages = state.messages.map(message => `
            <div class="mk-message mk-${message.role}">
                <div class="mk-role">${message.role === 'assistant' ? 'MIKONODE' : 'TÚ'}</div>
                <div class="mk-bubble">${text(message.text).replace(/\n/g, '<br>')}</div>
            </div>`).join('');
        return `
            <div class="mk-panel">
                <div class="mk-header">
                    <div><div class="mk-title">Mikonode <small>v${VERSION}</small></div><div class="mk-subtitle">Modela · Analiza · Aprende</div></div>
                    <div class="mk-status"><span></span>${status}</div>
                </div>
                <div class="mk-context"><b>${text(summary.proyecto)}</b><br>${text(summary.formato)} · ${summary.cubos} cubos · ${summary.grupos} grupos · ${summary.seleccionados} seleccionados<br><span>${reference}</span></div>
                <div class="mk-messages">${messages}</div>
                <div class="mk-actions">
                    <button data-action="analyze">Analizar modelo</button>
                    <button data-action="apply" ${state.lastPlan ? '' : 'disabled'}>Aplicar plan</button>
                    <button data-action="reference">Agregar boceto</button>
                    <button data-action="settings">Configuración</button>
                </div>
                <div class="mk-quick"><button data-action="sword">⚔ Espada</button><button data-action="dragon">🐉 Dragón</button><button data-action="weapon">🔧 Arma</button></div>
                <div class="mk-input"><textarea data-role="prompt" placeholder="Describe qué quieres modelar o cambiar...">${text(state.prompt)}</textarea><button data-action="send" ${state.busy ? 'disabled' : ''}>➜</button></div>
                <div class="mk-hint">Ejemplo: «Crea un dragón estilo Minecraft con alas grandes»</div>
            </div>`;
    }

    function bindPanel() {
        if (!panel?.node) return;
        const root = panel.node.querySelector('.mk-panel');
        if (!root) return;
        const input = root.querySelector('[data-role="prompt"]');
        if (input) {
            input.addEventListener('input', event => { state.prompt = event.target.value; });
            input.addEventListener('keydown', event => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    handlePrompt(input.value);
                }
            });
        }
        root.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
            const action = button.getAttribute('data-action');
            if (action === 'send') handlePrompt(input?.value || state.prompt);
            else if (action === 'analyze') handleAnalyze();
            else if (action === 'apply' && state.lastPlan) {
                try {
                    const count = applyBlueprint(state.lastPlan).length;
                    state.lastPlan = null;
                    addMessage('assistant', `Plan aplicado correctamente. Creé ${count} elementos.`);
                } catch (error) {
                    addMessage('assistant', `No pude aplicar el plan: ${error.message || error}`);
                }
                renderPanel();
            } else if (action === 'reference') openReferencePicker();
            else if (action === 'settings') openSettings();
            else if (action === 'sword') quick('sword');
            else if (action === 'dragon') quick('dragon');
            else if (action === 'weapon') quick('weapon');
        }));
    }

    function renderPanel() {
        if (!panel?.node) return;
        panel.node.innerHTML = panelHtml();
        bindPanel();
        const messages = panel.node.querySelector('.mk-messages');
        if (messages) messages.scrollTop = messages.scrollHeight;
    }

    Plugin.register(PLUGIN_ID, {
        title: 'Mikonode',
        author: 'Sbtxx',
        description: 'Asistente de modelado con IA dentro de Blockbench.',
        icon: 'psychology',
        version: VERSION,
        variant: 'both',
        min_version: '4.8.0',
        tags: ['Minecraft', 'Utility', 'AI'],
        repository: 'https://github.com/Sbtxx/blockbench-model-copilot',

        onload() {
            styleSheet = Blockbench.addCSS(`
                .mk-panel{display:flex;flex-direction:column;height:100%;min-height:360px;font-size:12px}
                .mk-header{display:flex;justify-content:space-between;align-items:center;padding:10px;border-bottom:1px solid var(--color-border)}
                .mk-title{font-size:15px;font-weight:700}.mk-title small{opacity:.5;font-size:10px}.mk-subtitle{opacity:.6;margin-top:2px}
                .mk-status{opacity:.72;font-size:10px;display:flex;align-items:center;gap:5px}.mk-status span{width:7px;height:7px;border-radius:50%;background:#54b86b;display:inline-block}
                .mk-context{padding:8px 10px;background:var(--color-back);border-bottom:1px solid var(--color-border);line-height:1.45}.mk-context span{opacity:.55}
                .mk-messages{flex:1;min-height:130px;overflow:auto;padding:9px}.mk-message{margin-bottom:10px}.mk-role{font-size:9px;letter-spacing:.08em;opacity:.52;margin:0 2px 3px}
                .mk-bubble{border:1px solid var(--color-border);border-radius:7px;padding:8px;line-height:1.45;word-break:break-word}.mk-user .mk-bubble{background:var(--color-accent);color:var(--color-accent_text);border-color:transparent}
                .mk-actions,.mk-quick{display:flex;gap:5px;flex-wrap:wrap;padding:7px 9px;border-top:1px solid var(--color-border)}.mk-actions button,.mk-quick button{flex:1;min-width:90px}
                .mk-input{display:flex;gap:6px;padding:8px 9px 4px}.mk-input textarea{flex:1;min-height:58px;max-height:140px;resize:vertical;border:1px solid var(--color-border);background:var(--color-back);color:var(--color-text);border-radius:6px;padding:7px;font:inherit}.mk-input button{width:40px;align-self:stretch;font-size:16px}.mk-hint{padding:0 10px 8px;opacity:.45;font-size:10px}
            `);

            panel = new Panel('mikonode_panel', {
                name: 'Mikonode',
                icon: 'psychology',
                growable: true,
                resizable: true,
                default_position: { slot: 'right_bar', height: 460 }
            });
            renderPanel();

            openAction = new Action('mikonode_open', {
                name: 'Mikonode', icon: 'psychology', description: 'Abrir Mikonode',
                click() { panel?.selectTab(); }
            });
            MenuBar.addAction(openAction, 'tools');

            settingsAction = new Action('mikonode_settings', {
                name: 'Configuración de Mikonode', icon: 'settings',
                description: 'Configurar IA de Mikonode', click: openSettings
            });
            MenuBar.addAction(settingsAction, 'tools');

            imageInput = document.createElement('input');
            imageInput.type = 'file';
            imageInput.accept = 'image/png,image/jpeg,image/webp';
            imageInput.style.display = 'none';
            document.body.appendChild(imageInput);
            imageInput.addEventListener('change', () => {
                const file = imageInput.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                    referenceDataUrl = String(reader.result || '');
                    referenceName = file.name;
                    addMessage('assistant', `Boceto cargado: ${file.name}. Ahora describe cómo quieres convertirlo en un modelo.`);
                };
                reader.readAsDataURL(file);
            });

            selectionListener = () => renderPanel();
            Blockbench.on('update_selection', selectionListener);
        },

        onunload() {
            if (openAction) openAction.delete();
            if (settingsAction) settingsAction.delete();
            if (panel) panel.delete();
            if (selectionListener) Blockbench.removeListener('update_selection', selectionListener);
            if (styleSheet) styleSheet.delete();
            if (imageInput) imageInput.remove();
            panel = null;
            openAction = null;
            settingsAction = null;
            selectionListener = null;
            styleSheet = null;
            imageInput = null;
            referenceDataUrl = null;
            referenceName = null;
        },

        oninstall() {
            Blockbench.showQuickMessage(`Mikonode ${VERSION} instalado`);
        }
    });
})();
