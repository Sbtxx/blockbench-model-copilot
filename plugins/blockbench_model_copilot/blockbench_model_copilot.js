/// <reference types="blockbench-types" />

(function () {
    'use strict';

    const PLUGIN_ID = 'blockbench_model_copilot';
    const VERSION = '0.3.0';
    const STORAGE_KEY = 'mikonode_ai_config_v3';
    const MAX_OPERATIONS = 80;
    const MAX_PROMPT = 10000;
    const MAX_ELEMENTS = 120;
    const MAX_REFERENCE_BYTES = 6 * 1024 * 1024;
    const MAX_REFERENCES = 3;

    let panel = null;
    let openAction = null;
    let settingsAction = null;
    let selectionListener = null;
    let styleSheet = null;
    let imageInput = null;
    let settingsDialog = null;

    const state = {
        busy: false,
        prompt: '',
        lastPlan: null,
        references: [],
        messages: [
            { role: 'assistant', text: 'Hola. Soy Mikonode. Describe qué quieres modelar, adjunta referencias o pide cambios sobre tu modelo.' }
        ]
    };

    const defaultConfig = {
        enabled: false,
        provider: 'openai_responses',
        endpoint: 'https://api.openai.com/v1/responses',
        model: 'gpt-5.6-luna',
        apiKey: '',
        timeoutMs: 60000,
        sendModelSnapshot: true,
        sendImages: true
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
        const c = getConfig();
        return Boolean(c.enabled && c.endpoint && c.model && c.apiKey);
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
        })[char]);
    }

    function safeName(value, fallback = 'pieza') {
        return String(value || fallback)
            .slice(0, 64)
            .replace(/[^\w\- áéíóúÁÉÍÓÚñÑ]/g, '')
            .trim() || fallback;
    }

    function vector(value, fallback = [0, 0, 0], min = -64, max = 64) {
        if (!Array.isArray(value) || value.length !== 3) return fallback.slice();
        return value.map((item, index) => {
            const n = Number(item);
            if (!Number.isFinite(n)) return fallback[index] ?? fallback[0];
            return Math.max(min, Math.min(max, n));
        });
    }

    function modelSnapshot() {
        const snapshot = {
            proyecto: typeof Project !== 'undefined' && Project ? (Project.name || 'Proyecto sin nombre') : 'Sin proyecto',
            formato: typeof Format !== 'undefined' && Format ? (Format.id || Format.name || 'Desconocido') : 'Desconocido',
            cubos: typeof Cube !== 'undefined' && Array.isArray(Cube.all) ? Cube.all.length : 0,
            grupos: typeof Group !== 'undefined' && Array.isArray(Group.all) ? Group.all.length : 0,
            mallas: typeof Mesh !== 'undefined' && Array.isArray(Mesh.all) ? Mesh.all.length : 0,
            texturas: typeof Texture !== 'undefined' && Array.isArray(Texture.all) ? Texture.all.length : 0,
            animaciones: typeof Animation !== 'undefined' && Array.isArray(Animation.all) ? Animation.all.length : 0,
            seleccionados: typeof OutlinerElement !== 'undefined' && Array.isArray(OutlinerElement.selected) ? OutlinerElement.selected.length : 0,
            elementos: []
        };
        if (typeof Outliner !== 'undefined' && Array.isArray(Outliner.elements)) {
            for (const element of Outliner.elements.slice(0, MAX_ELEMENTS)) {
                snapshot.elementos.push({
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
        return snapshot;
    }

    function selectedElements() {
        if (typeof OutlinerElement !== 'undefined' && Array.isArray(OutlinerElement.selected)) return OutlinerElement.selected.slice(0, 30);
        if (typeof Cube !== 'undefined' && Array.isArray(Cube.selected)) return Cube.selected.slice(0, 30);
        return [];
    }

    function selectionSnapshot() {
        return selectedElements().map(element => ({
            tipo: element.type || 'element',
            nombre: element.name || 'sin_nombre',
            uuid: element.uuid || null,
            desde: Array.isArray(element.from) ? element.from.slice() : undefined,
            hasta: Array.isArray(element.to) ? element.to.slice() : undefined,
            origen: Array.isArray(element.origin) ? element.origin.slice() : undefined,
            rotacion: Array.isArray(element.rotation) ? element.rotation.slice() : undefined
        }));
    }

    function addMessage(role, message) {
        state.messages.push({ role, text: String(message) });
        if (state.messages.length > 36) state.messages.shift();
        renderPanel();
    }

    function setBusy(value) {
        state.busy = Boolean(value);
        renderPanel();
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
            if (start < 0 || end <= start) throw new Error('La IA no devolvió JSON válido.');
            return JSON.parse(value.slice(start, end + 1));
        }
    }

    function systemPrompt(mode) {
        const lines = [
            'Eres Mikonode, un asistente experto de modelado 3D dentro de Blockbench.',
            'Tu objetivo es ayudar a crear modelos editables, claros y de estilo Minecraft/low-poly.',
            'No devuelvas ni ejecutes JavaScript.',
            'Para modificar el modelo usa solo operaciones permitidas.',
            'Respeta las coordenadas -64..64 y evita geometría degenerada.',
            'Prioriza silueta, proporciones, simetría y jerarquía antes que microdetalles.',
            'Cuando exista una referencia visual, úsala para extraer silueta, proporciones, piezas y detalles visibles; no inventes elementos que contradigan la imagen.'
        ];
        if (mode === 'plan') {
            lines.push(
                'Devuelve SOLO un objeto JSON, sin Markdown.',
                'Esquema: {"titulo":string,"resumen":string,"estilo":string,"operaciones":[...]}',
                'crear_grupo: {"tipo":"crear_grupo","id":string,"nombre":string,"parentId":string|null,"origen":[x,y,z],"rotacion":[x,y,z]}',
                'crear_cubo: {"tipo":"crear_cubo","id":string,"nombre":string,"parentId":string|null,"desde":[x,y,z],"hasta":[x,y,z],"origen":[x,y,z],"rotacion":[x,y,z]}',
                'mover: {"tipo":"mover","objetivo":string,"delta":[x,y,z]}',
                'escalar: {"tipo":"escalar","objetivo":string,"escala":[x,y,z]}',
                'rotar: {"tipo":"rotar","objetivo":string,"rotacion":[x,y,z]}',
                'renombrar: {"tipo":"renombrar","objetivo":string,"nombre":string}',
                'eliminar: {"tipo":"eliminar","objetivo":string}',
                'crear_grupo se usa para jerarquía; crear_cubo para geometría. parentId debe apuntar a un id de grupo creado en el mismo plan o ser null.',
                'Para editar elementos existentes, objetivo debe ser su uuid o nombre EXACTO según el contexto recibido.',
                `No superes ${MAX_OPERATIONS} operaciones.`
            );
        } else if (mode === 'review') {
            lines.push(
                'Devuelve SOLO JSON.',
                'Esquema: {"puntuacion":0,"fortalezas":[""],"problemas":[{"severidad":"baja|media|alta","mensaje":""}],"sugerencias":[""]}',
                'Evalúa silueta, proporciones, simetría, jerarquía, consistencia de nombres y preparación para textura/animación.'
            );
        } else {
            lines.push('Devuelve una explicación práctica en Markdown breve. Enseña primero silueta, luego proporciones, formas secundarias y detalles.');
        }
        return lines.join('\n');
    }

    function normalizeOperation(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const type = String(raw.tipo || raw.type || '').toLowerCase();
        if (!type) return null;
        return {
            type,
            id: raw.id ? String(raw.id).slice(0, 64) : undefined,
            nombre: safeName(raw.nombre || raw.name),
            objetivo: raw.objetivo || raw.target ? String(raw.objetivo || raw.target).slice(0, 100) : undefined,
            parentId: raw.parentId ? String(raw.parentId).slice(0, 64) : null,
            origen: vector(raw.origen || raw.origin),
            desde: vector(raw.desde || raw.from, [-8, -8, -8]),
            hasta: vector(raw.hasta || raw.to, [8, 8, 8]),
            rotacion: vector(raw.rotacion || raw.rotation),
            delta: vector(raw.delta, [0, 0, 0], -32, 32),
            escala: vector(raw.escala || raw.scale, [1, 1, 1], 0.1, 4),
            reemplazar: Boolean(raw.reemplazar)
        };
    }

    function validateBlueprint(data) {
        if (!data || typeof data !== 'object') throw new Error('El plan no es válido.');
        if (!Array.isArray(data.operaciones)) throw new Error('El plan no contiene operaciones.');
        if (data.operaciones.length > MAX_OPERATIONS) throw new Error(`El plan supera ${MAX_OPERATIONS} operaciones.`);
        const allowed = new Set(['crear_grupo', 'crear_cubo', 'mover', 'escalar', 'rotar', 'renombrar', 'eliminar']);
        const ops = data.operaciones.map(normalizeOperation).filter(Boolean);
        if (!ops.length) throw new Error('El plan está vacío.');
        for (const op of ops) {
            if (!allowed.has(op.type)) throw new Error(`Operación no permitida: ${op.type}`);
            if (op.type === 'crear_cubo') {
                if (!Array.isArray(op.desde) || !Array.isArray(op.hasta)) throw new Error('Un cubo no tiene límites válidos.');
                if (op.desde.some(v => !Number.isFinite(v)) || op.hasta.some(v => !Number.isFinite(v))) throw new Error('Un cubo contiene coordenadas inválidas.');
                if (op.desde.some((v, i) => v === op.hasta[i])) throw new Error(`El cubo «${op.nombre}» tiene una dimensión de tamaño 0.`);
            }
            if (op.type === 'crear_grupo' && !op.id) throw new Error('Cada grupo nuevo necesita id.');
            if (op.type === 'rotar' && !Array.isArray(op.rotacion)) throw new Error('Rotación inválida.');
        }
        return {
            titulo: String(data.titulo || data.title || 'Plan de modelo').slice(0, 120),
            resumen: String(data.resumen || data.summary || '').slice(0, 1200),
            estilo: String(data.estilo || data.style || '').slice(0, 240),
            operaciones: ops
        };
    }

    function resolveElement(identifier) {
        if (!identifier) return null;
        const key = String(identifier);
        const pool = [];
        if (typeof Cube !== 'undefined' && Array.isArray(Cube.all)) pool.push(...Cube.all);
        if (typeof Group !== 'undefined' && Array.isArray(Group.all)) pool.push(...Group.all);
        let exact = pool.find(element => element.uuid === key);
        if (exact) return exact;
        exact = pool.find(element => element.name === key);
        if (exact) return exact;
        const lower = key.toLowerCase();
        return pool.find(element => String(element.name || '').toLowerCase() === lower) || null;
    }

    function applyOneOperation(op, groups, created) {
        if (op.type === 'crear_grupo') {
            const group = new Group({ name: op.nombre, origin: op.origen, rotation: op.rotacion }).init();
            const parent = op.parentId ? groups.get(op.parentId) : null;
            if (parent && typeof group.addTo === 'function') group.addTo(parent);
            groups.set(op.id || op.nombre, group);
            created.push(group);
            return;
        }
        if (op.type === 'crear_cubo') {
            const cube = new Cube({ name: op.nombre, from: op.desde, to: op.hasta, origin: op.origen, rotation: op.rotacion }).init();
            const parent = op.parentId ? groups.get(op.parentId) : null;
            if (parent && typeof cube.addTo === 'function') cube.addTo(parent);
            created.push(cube);
            return;
        }
        const target = resolveElement(op.objetivo);
        if (!target) return;
        if (op.type === 'mover') {
            if (Array.isArray(target.from) && Array.isArray(target.to)) {
                target.from = target.from.map((v, i) => v + op.delta[i]);
                target.to = target.to.map((v, i) => v + op.delta[i]);
            }
            if (Array.isArray(target.origin)) target.origin = target.origin.map((v, i) => v + op.delta[i]);
        } else if (op.type === 'escalar' && Array.isArray(target.from) && Array.isArray(target.to)) {
            const center = target.from.map((v, i) => (v + target.to[i]) / 2);
            target.from = center.map((v, i) => v - ((target.to[i] - target.from[i]) * op.escala[i]) / 2);
            target.to = center.map((v, i) => v + ((target.to[i] - target.from[i]) * op.escala[i]) / 2);
        } else if (op.type === 'rotar' && Array.isArray(target.rotation)) {
            target.rotation = op.rotacion.slice();
        } else if (op.type === 'renombrar') {
            target.name = safeName(op.nombre, target.name || 'pieza');
        } else if (op.type === 'eliminar' && typeof target.remove === 'function') {
            target.remove();
        }
    }

    function applyBlueprint(blueprint) {
        const created = [];
        const groups = new Map();
        Undo.initEdit({ elements: [], outliner: true, selection: true });
        try {
            for (const op of blueprint.operaciones.filter(item => item.type === 'crear_grupo')) applyOneOperation(op, groups, created);
            for (const op of blueprint.operaciones.filter(item => item.type === 'crear_cubo')) applyOneOperation(op, groups, created);
            for (const op of blueprint.operaciones.filter(item => !item.type.startsWith('crear_'))) applyOneOperation(op, groups, created);
            if (typeof Canvas !== 'undefined' && typeof Canvas.updateView === 'function') {
                Canvas.updateView({ elements: created, element_aspects: { geometry: true }, selection: true });
            } else if (typeof Canvas !== 'undefined' && typeof Canvas.updateAll === 'function') {
                Canvas.updateAll();
            }
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
        else if (/drag[oó]n|dragon/.test(value)) kind = 'dragon';
        const operations = [{ type: 'crear_grupo', id: 'root', nombre: `mikonode_${kind}`, parentId: null, origen: [0, 0, 0], rotacion: [0, 0, 0] }];
        const cube = (id, nombre, desde, hasta, origen = [0, 0, 0], rotacion = [0, 0, 0]) => operations.push({ type: 'crear_cubo', id, nombre, parentId: 'root', desde, hasta, origen, rotacion });
        if (kind === 'espada') {
            cube('mango', 'mango', [-1, -6, -1], [1, 3, 1], [0, -4, 0]);
            cube('guardia', 'guardia', [-4, 2, -1], [4, 4, 1], [0, 3, 0]);
            cube('hoja', 'hoja', [-2, 4, -1], [2, 20, 1], [0, 4, 0]);
            cube('punta', 'punta', [-1, 20, -0.7], [1, 22, 0.7], [0, 20, 0]);
        } else if (kind === 'arma') {
            cube('cuerpo', 'cuerpo', [-5, -2, -2], [5, 6, 2]);
            cube('cañon', 'cañon', [-1.5, 6, -1.5], [1.5, 20, 1.5], [0, 6, 0]);
            cube('empuñadura', 'empuñadura', [-3, -8, -1.5], [3, 0, 1.5], [0, -4, 0]);
            cube('culata', 'culata', [-5, -7, -2], [-1, -1, 2], [-3, -5, 0]);
        } else if (kind === 'dragon') {
            cube('cuerpo', 'cuerpo', [-6, 0, -4], [6, 10, 4], [0, 4, 0]);
            cube('cabeza', 'cabeza', [-5, 9, -5], [5, 16, 5], [0, 12, 0]);
            cube('hocico', 'hocico', [-3, 11, -9], [3, 16, -5], [0, 13, -7]);
            cube('ala_izq', 'ala_izq', [5, 6, -1], [13, 15, 1], [6, 8, 0]);
            cube('ala_der', 'ala_der', [-13, 6, -1], [-5, 15, 1], [-6, 8, 0]);
            cube('cola', 'cola', [-3, -8, -2], [3, 0, 2], [0, -5, 1]);
        } else if (kind === 'casco') {
            cube('cascara', 'cascara', [-8, 8, -6], [8, 24, 6], [0, 16, 0]);
            cube('visor', 'visor', [-6, 13, -9], [6, 16, -7], [0, 14, -8]);
        } else if (kind === 'hacha') {
            cube('mango', 'mango', [-1, -8, -1], [1, 8, 1]);
            cube('cabeza', 'cabeza', [0, 4, -1], [7, 10, 3], [1, 7, 0]);
        } else if (kind === 'martillo') {
            cube('mango', 'mango', [-1, -8, -1], [1, 8, 1]);
            cube('cabeza', 'cabeza', [-5, 7, -2], [5, 12, 2], [0, 9, 0]);
        } else {
            cube('cuerpo', 'cuerpo', [-5, 0, -3], [5, 10, 3], [0, 5, 0]);
            cube('superior', 'superior', [-4, 10, -2], [4, 18, 2], [0, 10, 0]);
            cube('detalle', 'detalle', [-2, 18, -1], [2, 22, 1], [0, 18, 0]);
        }
        return validateBlueprint({ titulo: `Mikonode — ${kind}`, resumen: 'Plan local de respaldo listo para aplicar.', estilo: 'Minecraft / low-poly', operaciones });
    }

    function makeReferenceDataUrl(file) {
        return new Promise((resolve, reject) => {
            if (!file || !file.type.startsWith('image/')) return reject(new Error('El archivo no es una imagen.'));
            if (file.size > MAX_REFERENCE_BYTES) return reject(new Error('La imagen supera 6 MB.'));
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('No pude leer la imagen.'));
            reader.onload = () => {
                const source = new Image();
                source.onload = () => {
                    const maxSide = 1400;
                    const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
                    const width = Math.max(1, Math.round(source.width * scale));
                    const height = Math.max(1, Math.round(source.height * scale));
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(source, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', 0.86));
                };
                source.onerror = () => reject(new Error('No pude procesar la imagen.'));
                source.src = String(reader.result || '');
            };
            reader.readAsDataURL(file);
        });
    }

    function referenceParts() {
        return state.references.map(ref => ({ type: 'input_image', image_url: ref.dataUrl, detail: 'high' }));
    }

    function buildUserText(mode, prompt) {
        const payload = {
            tarea: String(prompt || '').slice(0, MAX_PROMPT),
            modo: mode,
            instrucciones: 'Analiza el contexto del proyecto y, si hay referencias, úsalas para decidir proporciones y piezas.',
            seleccion: selectionSnapshot()
        };
        if (getConfig().sendModelSnapshot) payload.modelo_actual = modelSnapshot();
        if (state.references.length) payload.referencias = state.references.map(ref => ref.name);
        return JSON.stringify(payload, null, 2);
    }

    async function fetchJson(url, options, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.max(8000, Number(timeoutMs) || 60000));
        try {
            return await fetch(url, { ...options, signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }
    }

    function extractResponsesText(payload) {
        if (typeof payload?.output_text === 'string') return payload.output_text;
        if (Array.isArray(payload?.output)) {
            const chunks = [];
            for (const item of payload.output) {
                if (Array.isArray(item.content)) {
                    for (const content of item.content) if (typeof content?.text === 'string') chunks.push(content.text);
                }
            }
            if (chunks.length) return chunks.join('\n');
        }
        return null;
    }

    function extractChatText(payload) {
        const content = payload?.choices?.[0]?.message?.content;
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) return content.map(part => part?.text || '').join('');
        return null;
    }

    async function callAi(mode, prompt) {
        const config = getConfig();
        if (!aiConfigured()) throw new Error('La IA no está configurada. Abre Herramientas → Configuración de Mikonode.');

        const userText = buildUserText(mode, prompt);
        const hasImages = state.references.length && config.sendImages;
        const inputContent = [{ type: 'input_text', text: userText }];
        if (hasImages && config.provider === 'openai_responses') inputContent.push(...referenceParts());

        let body;
        let parser;
        if (config.provider === 'openai_responses') {
            body = {
                model: config.model,
                input: [
                    { role: 'system', content: [{ type: 'input_text', text: systemPrompt(mode) }] },
                    { role: 'user', content: inputContent }
                ]
            };
            if (mode === 'plan' || mode === 'review') body.text = { format: { type: 'json_object' } };
            parser = extractResponsesText;
        } else {
            const chatContent = [{ type: 'text', text: userText }];
            if (hasImages) for (const ref of state.references) chatContent.push({ type: 'image_url', image_url: { url: ref.dataUrl, detail: 'high' } });
            body = {
                model: config.model,
                temperature: 0.2,
                messages: [
                    { role: 'system', content: systemPrompt(mode) },
                    { role: 'user', content: chatContent }
                ]
            };
            parser = extractChatText;
        }

        const response = await fetchJson(config.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify(body)
        }, config.timeoutMs);
        const raw = await response.text();
        let payload;
        try { payload = JSON.parse(raw); } catch { payload = null; }
        if (!response.ok) {
            const apiMessage = payload?.error?.message || raw.slice(0, 500);
            const apiCode = payload?.error?.code ? ` [${payload.error.code}]` : '';
            throw new Error(`API ${response.status}${apiCode}: ${apiMessage}`);
        }
        const result = parser(payload);
        if (!result) throw new Error('La API no devolvió texto utilizable.');
        return result;
    }

    function localReview() {
        const summary = modelSnapshot();
        const problems = [];
        const suggestions = [];
        if (summary.cubos === 0) {
            problems.push({ severidad: 'alta', mensaje: 'El proyecto no tiene cubos.' });
            suggestions.push('Construye una silueta base antes de añadir detalles.');
        }
        if (summary.cubos > 0 && summary.grupos === 0) suggestions.push('Crea grupos para separar partes y facilitar cambios.');
        if (summary.cubos > 0 && summary.texturas === 0) suggestions.push('Cuando la geometría esté lista, añade una textura y revisa UV.');
        if (summary.seleccionados === 0 && summary.cubos > 0) suggestions.push('Selecciona una pieza para recibir recomendaciones más específicas.');
        return {
            puntuacion: Math.max(0, 100 - problems.length * 20),
            fortalezas: summary.cubos ? ['La geometría es editable dentro de Blockbench.'] : [],
            problemas,
            sugerencias: suggestions
        };
    }

    function formatReview(review) {
        const score = Number(review?.puntuacion ?? review?.score ?? 0);
        const strengths = review?.fortalezas || review?.strengths || [];
        const problems = review?.problemas || review?.issues || [];
        const suggestions = review?.sugerencias || review?.suggestions || [];
        return [
            `ANÁLISIS DEL MODELO — ${score}/100`,
            '',
            'Fortalezas:',
            strengths.length ? strengths.map(v => `• ${v}`).join('\n') : '• Ninguna detectada.',
            '',
            'Problemas:',
            problems.length ? problems.map(v => `• ${v.mensaje || v.message}`).join('\n') : '• Ninguno detectado.',
            '',
            'Sugerencias:',
            suggestions.length ? suggestions.map(v => `• ${v}`).join('\n') : '• El modelo va por buen camino.'
        ].join('\n');
    }

    async function handleAnalyze() {
        if (state.busy) return;
        setBusy(true);
        try {
            if (aiConfigured()) {
                const review = parseJson(await callAi('review', 'Analiza el modelo actual con atención a proporciones, silueta, jerarquía, simetría, preparación para textura y animación.'));
                addMessage('assistant', formatReview(review));
            } else {
                addMessage('assistant', `${formatReview(localReview())}\n\nActiva una API para un análisis visual y contextual más avanzado.`);
            }
        } catch (error) {
            addMessage('assistant', `No pude completar el análisis: ${error.message || error}`);
        } finally {
            setBusy(false);
        }
    }

    async function handlePrompt(prompt) {
        const trimmed = String(prompt || '').trim().slice(0, MAX_PROMPT);
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
            if (/ens[eé]ñame|teach me|c[oó]mo modelar|como modelar/.test(lower)) {
                if (aiConfigured()) addMessage('assistant', await callAi('teach', trimmed));
                else addMessage('assistant', 'Empieza por la silueta, continúa con proporciones, añade formas secundarias y termina con detalles.');
                return;
            }

            let blueprint = null;
            if (aiConfigured()) {
                try {
                    blueprint = validateBlueprint(parseJson(await callAi('plan', trimmed)));
                } catch (error) {
                    addMessage('assistant', `La IA no produjo un plan válido (${error.message || error}). Usaré el generador local.`);
                }
            }
            if (!blueprint) blueprint = localBlueprint(trimmed);
            state.lastPlan = blueprint;
            const imageNote = state.references.length ? `\nReferencias usadas: ${state.references.length}` : '';
            addMessage('assistant', `${blueprint.titulo}\n\n${blueprint.resumen || 'Plan listo.'}\n\nOperaciones: ${blueprint.operaciones.length}${imageNote}\n\nRevisa el plan y pulsa «Aplicar plan».`);
        } catch (error) {
            addMessage('assistant', `Ocurrió un error: ${error.message || error}`);
        } finally {
            setBusy(false);
        }
    }

    async function testConnection() {
        const config = getConfig();
        if (!config.apiKey || !config.endpoint || !config.model) {
            Blockbench.showMessageBox({ title: 'Mikonode', message: 'Completa endpoint, modelo y API key antes de probar la conexión.' });
            return false;
        }
        setBusy(true);
        try {
            const result = await callAi('teach', 'Responde exactamente: CONEXION_OK');
            addMessage('assistant', `Conexión correcta. Respuesta del proveedor: ${String(result).slice(0, 120)}`);
            return true;
        } catch (error) {
            addMessage('assistant', `La conexión falló: ${error.message || error}`);
            return false;
        } finally {
            setBusy(false);
        }
    }

    function openReferencePicker() {
        if (!imageInput) return;
        if (state.references.length >= MAX_REFERENCES) {
            Blockbench.showMessageBox({ title: 'Mikonode', message: `Puedes adjuntar hasta ${MAX_REFERENCES} referencias por vez.` });
            return;
        }
        imageInput.value = '';
        imageInput.click();
    }

    function removeReference(index) {
        state.references.splice(index, 1);
        renderPanel();
    }

    async function handleReferenceFiles(files) {
        const queue = Array.from(files || []).slice(0, MAX_REFERENCES - state.references.length);
        for (const file of queue) {
            try {
                const dataUrl = await makeReferenceDataUrl(file);
                state.references.push({ name: file.name, dataUrl });
                addMessage('assistant', `Referencia cargada: ${file.name}. Ahora dime qué parte quieres convertir o ajustar.`);
            } catch (error) {
                addMessage('assistant', `No pude cargar ${file.name}: ${error.message || error}`);
            }
        }
    }

    function openSettings() {
        const c = getConfig();
        if (typeof Dialog === 'undefined') {
            const provider = prompt('Proveedor (openai_responses u openai_chat):', c.provider) || c.provider;
            const endpoint = prompt('Endpoint:', c.endpoint) || c.endpoint;
            const model = prompt('Modelo:', c.model) || c.model;
            const apiKey = prompt('API key:', c.apiKey ? '******** (conservada)' : '') === null ? c.apiKey : (c.apiKey || prompt('API key nueva:', ''));
            saveConfig({ ...c, enabled: true, provider, endpoint, model, apiKey });
            renderPanel();
            return;
        }

        if (settingsDialog) { settingsDialog.delete(); settingsDialog = null; }
        settingsDialog = new Dialog('mikonode_ai_settings', {
            title: 'Mikonode — Configuración de IA',
            icon: 'psychology',
            width: 620,
            resizable: 'y',
            form: {
                enabled: { label: 'Activar IA', type: 'checkbox', value: c.enabled },
                provider: {
                    label: 'Proveedor / formato', type: 'select',
                    options: { 'openai_responses': 'OpenAI Responses', 'openai_chat': 'OpenAI Chat Completions / compatible' },
                    value: c.provider
                },
                endpoint: { label: 'Endpoint', type: 'text', value: c.endpoint },
                model: { label: 'Modelo', type: 'text', value: c.model },
                apiKey: { label: 'API key', type: 'text', value: c.apiKey, description: 'Se guarda localmente en Blockbench. Nunca la incluyas en GitHub.' },
                timeoutMs: { label: 'Tiempo límite (ms)', type: 'number', value: c.timeoutMs },
                sendModelSnapshot: { label: 'Enviar contexto del modelo', type: 'checkbox', value: c.sendModelSnapshot },
                sendImages: { label: 'Enviar referencias de imagen a la IA', type: 'checkbox', value: c.sendImages }
            },
            lines: [
                '<div style="line-height:1.5; opacity:.82">Mikonode no usa una API key compartida. Cada usuario debe aportar sus propias credenciales. Las referencias se reducen y se envían solo al proveedor cuando la opción está activa.</div>',
                '<div style="margin-top:8px; opacity:.68">Para OpenAI, los modelos actuales con visión funcionan con la Responses API; puedes cambiar el modelo manualmente cuando el proveedor lo requiera.</div>'
            ],
            buttons: ['Guardar', 'Probar conexión', 'Cancelar'],
            confirmIndex: 0,
            cancelIndex: 2,
            onButton(index) {
                if (index === 1) {
                    const result = settingsDialog.getFormResult();
                    const next = {
                        ...c,
                        enabled: Boolean(result.enabled),
                        provider: String(result.provider || c.provider),
                        endpoint: String(result.endpoint || c.endpoint).trim(),
                        model: String(result.model || c.model).trim(),
                        apiKey: String(result.apiKey || '').trim() || c.apiKey,
                        timeoutMs: Math.max(8000, Number(result.timeoutMs) || 60000),
                        sendModelSnapshot: Boolean(result.sendModelSnapshot),
                        sendImages: Boolean(result.sendImages)
                    };
                    saveConfig(next);
                    return testConnection();
                }
            },
            onConfirm(result) {
                const next = {
                    ...c,
                    enabled: Boolean(result.enabled),
                    provider: String(result.provider || c.provider),
                    endpoint: String(result.endpoint || c.endpoint).trim(),
                    model: String(result.model || c.model).trim(),
                    apiKey: String(result.apiKey || '').trim() || c.apiKey,
                    timeoutMs: Math.max(8000, Number(result.timeoutMs) || 60000),
                    sendModelSnapshot: Boolean(result.sendModelSnapshot),
                    sendImages: Boolean(result.sendImages)
                };
                saveConfig(next);
                addMessage('assistant', 'Configuración de IA guardada localmente.');
            }
        });
        settingsDialog.show();
    }

    function planSummary(plan) {
        if (!plan) return '';
        const preview = plan.operaciones.slice(0, 10).map((op, index) => {
            const subject = op.nombre || op.objetivo || op.id || 'pieza';
            return `${index + 1}. ${op.type} → ${subject}`;
        }).join('\n');
        const more = plan.operaciones.length > 10 ? `\n… y ${plan.operaciones.length - 10} más` : '';
        return `\n\nPLAN\n${preview}${more}`;
    }

    function panelHtml() {
        const summary = modelSnapshot();
        const config = getConfig();
        const status = aiConfigured() ? `IA · ${config.model}` : 'Modo local';
        const messages = state.messages.map(message => `
            <div class="mk-message mk-${message.role}">
                <div class="mk-role">${message.role === 'assistant' ? 'MIKONODE' : 'TÚ'}</div>
                <div class="mk-bubble">${escapeHtml(message.text).replace(/\n/g, '<br>')}</div>
            </div>`).join('');
        const refs = state.references.length ? state.references.map((ref, index) => `
            <div class="mk-ref"><span>🖼 ${escapeHtml(ref.name)}</span><button data-ref-remove="${index}" title="Quitar referencia">×</button></div>`).join('') : '<span class="mk-ref-empty">Sin referencias</span>';
        const plan = state.lastPlan ? `<div class="mk-plan"><b>${escapeHtml(state.lastPlan.titulo)}</b><div>${escapeHtml(state.lastPlan.resumen || '')}</div><small>${state.lastPlan.operaciones.length} operaciones${planSummary(state.lastPlan)}</small></div>` : '';
        return `
            <div class="mk-panel">
                <div class="mk-header">
                    <div><div class="mk-title">Mikonode <small>v${VERSION}</small></div><div class="mk-subtitle">Modela · Analiza · Aprende</div></div>
                    <div class="mk-status"><span></span>${escapeHtml(status)}</div>
                </div>
                <div class="mk-context"><b>${escapeHtml(summary.proyecto)}</b><br>${escapeHtml(summary.formato)} · ${summary.cubos} cubos · ${summary.grupos} grupos · ${summary.seleccionados} seleccionados</div>
                <div class="mk-refs"><div class="mk-ref-title">Referencias (${state.references.length}/${MAX_REFERENCES})</div>${refs}</div>
                <div class="mk-messages">${messages}</div>
                ${plan}
                <div class="mk-actions">
                    <button data-action="analyze">Analizar</button>
                    <button data-action="apply" ${state.lastPlan ? '' : 'disabled'}>Aplicar plan</button>
                    <button data-action="reference">Agregar referencia</button>
                    <button data-action="clear_refs" ${state.references.length ? '' : 'disabled'}>Quitar referencias</button>
                    <button data-action="settings">IA / Configuración</button>
                </div>
                <div class="mk-quick"><button data-action="sword">⚔ Espada</button><button data-action="dragon">🐉 Dragón</button><button data-action="weapon">🔧 Arma</button></div>
                <div class="mk-input"><textarea data-role="prompt" placeholder="Describe qué quieres modelar o cambiar...">${escapeHtml(state.prompt)}</textarea><button data-action="send" ${state.busy ? 'disabled' : ''}>➜</button></div>
                <div class="mk-hint">Ctrl/Cmd + Enter · Texto + referencias → plan editable · Sin API: generador local</div>
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
        root.querySelectorAll('[data-ref-remove]').forEach(button => button.addEventListener('click', () => removeReference(Number(button.getAttribute('data-ref-remove')))));
        root.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
            const action = button.getAttribute('data-action');
            if (action === 'send') await handlePrompt(input?.value || state.prompt);
            else if (action === 'analyze') await handleAnalyze();
            else if (action === 'apply' && state.lastPlan) {
                try {
                    const count = applyBlueprint(state.lastPlan).length;
                    state.lastPlan = null;
                    addMessage('assistant', `Plan aplicado correctamente. Creé ${count} elementos.`);
                } catch (error) {
                    addMessage('assistant', `No pude aplicar el plan: ${error.message || error}`);
                }
            } else if (action === 'reference') openReferencePicker();
            else if (action === 'clear_refs') { state.references = []; renderPanel(); }
            else if (action === 'settings') openSettings();
            else if (action === 'sword') await handlePrompt('Crea una espada estilo Minecraft con empuñadura, guardia, hoja y punta.');
            else if (action === 'dragon') await handlePrompt('Crea un dragón estilo Minecraft con cuerpo, cabeza, cola y alas grandes.');
            else if (action === 'weapon') await handlePrompt('Crea un arma futurista estilo Minecraft con cuerpo, cañón, empuñadura y culata.');
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
                .mk-panel{display:flex;flex-direction:column;height:100%;min-height:420px;font-size:12px}
                .mk-header{display:flex;justify-content:space-between;align-items:center;padding:10px;border-bottom:1px solid var(--color-border)}
                .mk-title{font-size:15px;font-weight:700}.mk-title small{opacity:.5;font-size:10px}.mk-subtitle{opacity:.6;margin-top:2px}
                .mk-status{opacity:.72;font-size:10px;display:flex;align-items:center;gap:5px;max-width:48%;text-align:right}.mk-status span{width:7px;height:7px;border-radius:50%;background:#54b86b;display:inline-block;flex:none}
                .mk-context{padding:8px 10px;background:var(--color-back);border-bottom:1px solid var(--color-border);line-height:1.45}
                .mk-refs{padding:7px 9px;border-bottom:1px solid var(--color-border)}.mk-ref-title{opacity:.65;font-size:10px;margin-bottom:5px}.mk-ref{display:flex;justify-content:space-between;gap:6px;padding:4px 6px;margin-bottom:4px;border:1px solid var(--color-border);border-radius:5px}.mk-ref button{min-width:20px}.mk-ref-empty{opacity:.45}
                .mk-messages{flex:1;min-height:130px;overflow:auto;padding:9px}.mk-message{margin-bottom:10px}.mk-role{font-size:9px;letter-spacing:.08em;opacity:.52;margin:0 2px 3px}.mk-bubble{border:1px solid var(--color-border);border-radius:7px;padding:8px;line-height:1.45;word-break:break-word}.mk-user .mk-bubble{background:var(--color-accent);color:var(--color-accent_text);border-color:transparent}
                .mk-plan{margin:0 9px 7px;padding:8px;border:1px solid var(--color-border);border-radius:7px;background:var(--color-back)}.mk-plan>div{margin-top:4px;opacity:.78}.mk-plan small{display:block;margin-top:5px;white-space:pre-wrap;opacity:.6}
                .mk-actions,.mk-quick{display:flex;gap:5px;flex-wrap:wrap;padding:7px 9px;border-top:1px solid var(--color-border)}.mk-actions button,.mk-quick button{flex:1;min-width:90px}
                .mk-input{display:flex;gap:6px;padding:8px 9px 4px}.mk-input textarea{flex:1;min-height:58px;max-height:150px;resize:vertical;border:1px solid var(--color-border);background:var(--color-back);color:var(--color-text);border-radius:6px;padding:7px;font:inherit}.mk-input button{width:42px;align-self:stretch;font-size:16px}.mk-hint{padding:0 10px 8px;opacity:.45;font-size:10px}
            `);

            panel = new Panel('mikonode_panel', {
                name: 'Mikonode', icon: 'psychology', growable: true, resizable: true,
                default_position: { slot: 'right_bar', height: 520 }
            });
            renderPanel();

            openAction = new Action('mikonode_open', {
                name: 'Mikonode', icon: 'psychology', description: 'Abrir Mikonode', click() { panel?.selectTab(); }
            });
            MenuBar.addAction(openAction, 'tools');

            settingsAction = new Action('mikonode_settings', {
                name: 'Configuración de Mikonode', icon: 'settings', description: 'Configurar IA de Mikonode', click: openSettings
            });
            MenuBar.addAction(settingsAction, 'tools');

            imageInput = document.createElement('input');
            imageInput.type = 'file';
            imageInput.accept = 'image/png,image/jpeg,image/webp';
            imageInput.multiple = true;
            imageInput.style.display = 'none';
            document.body.appendChild(imageInput);
            imageInput.addEventListener('change', () => handleReferenceFiles(imageInput.files));

            selectionListener = () => renderPanel();
            Blockbench.on('update_selection', selectionListener);
        },

        onunload() {
            if (openAction) openAction.delete();
            if (settingsAction) settingsAction.delete();
            if (panel) panel.delete();
            if (settingsDialog) settingsDialog.delete();
            if (selectionListener) Blockbench.removeListener('update_selection', selectionListener);
            if (styleSheet) styleSheet.delete();
            if (imageInput) imageInput.remove();
            panel = null; openAction = null; settingsAction = null; settingsDialog = null; selectionListener = null; styleSheet = null; imageInput = null;
            state.references = [];
        },

        oninstall() { Blockbench.showQuickMessage(`Mikonode ${VERSION} instalado`); }
    });
})();
