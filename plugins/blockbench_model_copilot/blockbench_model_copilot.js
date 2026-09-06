/// <reference types="blockbench-types" />

(function () {
    'use strict';

    const PLUGIN_ID = 'blockbench_model_copilot';
    const VERSION = '0.2.1';
    const STORAGE_KEY = 'mikonode_ai_config_v1';
    const MAX_OPERATIONS = 100;
    const MAX_PROMPT = 12000;

    let panel;
    let openAction;
    let settingsAction;
    let selectionListener;
    let css;
    let imageInput;
    let referenceDataUrl = null;
    let referenceName = null;

    const state = {
        busy: false,
        prompt: '',
        messages: [{
            role: 'assistant',
            text: 'Hola. Soy Mikonode. Describe un modelo, agrega un boceto o dime qué quieres cambiar en tu selección.'
        }],
        lastPlan: null,
        lastReview: null
    };

    const defaultConfig = {
        enabled: false,
        endpoint: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-4o-mini',
        apiKey: '',
        timeoutMs: 45000,
        sendModelSnapshot: true
    };

    function getConfig() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? {...defaultConfig, ...JSON.parse(raw)} : {...defaultConfig};
        } catch {
            return {...defaultConfig};
        }
    }

    function saveConfig(config) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({...defaultConfig, ...config}));
    }

    function aiConfigured() {
        const config = getConfig();
        return Boolean(config.enabled && config.endpoint && config.model && config.apiKey);
    }

    function safeText(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        })[character]);
    }

    function clampNumber(value, min, max) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : null;
    }

    function vector(value, fallback = [0, 0, 0], min = -64, max = 64) {
        if (!Array.isArray(value) || value.length !== 3) return fallback.slice();
        return value.map(component => clampNumber(component, min, max) ?? 0);
    }

    function addMessage(role, text) {
        state.messages.push({role, text: String(text)});
        if (state.messages.length > 40) state.messages.shift();
        renderPanel();
    }

    function setBusy(value) {
        state.busy = Boolean(value);
        renderPanel();
    }

    function summarizeProject(includeModel = getConfig().sendModelSnapshot) {
        const summary = {
            proyecto: typeof Project !== 'undefined' && Project ? (Project.name || 'Proyecto sin nombre') : 'Sin proyecto',
            formato: typeof Format !== 'undefined' && Format ? (Format.id || Format.name || 'Desconocido') : 'Desconocido',
            cubos: typeof Cube !== 'undefined' ? Cube.all.length : 0,
            grupos: typeof Group !== 'undefined' ? Group.all.length : 0,
            mallas: typeof Mesh !== 'undefined' ? Mesh.all.length : 0,
            texturas: typeof Texture !== 'undefined' ? Texture.all.length : 0,
            animaciones: typeof Animation !== 'undefined' ? Animation.all.length : 0,
            seleccionados: typeof OutlinerElement !== 'undefined' ? OutlinerElement.selected.length : 0
        };

        if (!includeModel) return summary;
        summary.elementos = [];
        if (typeof Outliner !== 'undefined' && Array.isArray(Outliner.elements)) {
            for (const element of Outliner.elements.slice(0, 80)) {
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

    function systemPrompt(mode) {
        const common = [
            'Eres Mikonode, un asistente de modelado 3D dentro de Blockbench.',
            'Ayuda a crear modelos estilo Minecraft que sean claros, editables y fáciles de continuar.',
            'Nunca devuelvas JavaScript ejecutable ni código arbitrario.',
            'Para modificar modelos usa solamente las operaciones permitidas por el esquema.',
            'Mantén coordenadas entre -64 y 64.',
            'Prefiere cubos y grupos simples antes que geometría innecesariamente compleja.',
            'Usa nombres cortos, claros y seguros para elementos.',
            'Prioriza silueta y proporciones antes que detalles pequeños.'
        ];
        if (mode === 'plan') {
            common.push(
                'Devuelve SOLO JSON válido.',
                'Esquema: {"titulo":string,"resumen":string,"estilo":string,"operaciones":[...]}',
                'crear_grupo: {"tipo":"crear_grupo","id":string,"nombre":string,"parentId":string|null,"origen":[x,y,z]}',
                'crear_cubo: {"tipo":"crear_cubo","id":string,"nombre":string,"parentId":string|null,"desde":[x,y,z],"hasta":[x,y,z],"origen":[x,y,z],"rotacion":[x,y,z]}',
                'mover: {"tipo":"mover","objetivo":string,"delta":[x,y,z]}',
                'escalar: {"tipo":"escalar","objetivo":string,"escala":[x,y,z]}',
                'renombrar: {"tipo":"renombrar","objetivo":string,"nombre":string}',
                'eliminar: {"tipo":"eliminar","objetivo":string}',
                'No superes 100 operaciones.'
            );
        } else if (mode === 'review') {
            common.push(
                'Devuelve SOLO JSON válido.',
                'Esquema: {"puntuacion":0,"fortalezas":[""],"problemas":[{"severidad":"baja|media|alta","mensaje":""}],"sugerencias":[""]}',
                'Basa la revisión solamente en la información entregada.'
            );
        } else {
            common.push('Devuelve Markdown breve y práctico.', 'Explica cómo modelar paso a paso desde la silueta hasta los detalles.');
        }
        return common.join('\n');
    }

    function stripFences(text) {
        return String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    }

    function parseJson(text) {
        const cleaned = stripFences(text);
        try { return JSON.parse(cleaned); } catch {}
        const firstCandidates = [cleaned.indexOf('{'), cleaned.indexOf('[')].filter(index => index >= 0);
        const first = firstCandidates.length ? Math.min(...firstCandidates) : -1;
        const last = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
        if (first < 0 || last <= first) throw new Error('La IA no devolvió un JSON válido.');
        return JSON.parse(cleaned.slice(first, last + 1));
    }

    function normalizeOperation(operation) {
        if (!operation || typeof operation !== 'object') return null;
        const type = String(operation.tipo || operation.type || '').toLowerCase();
        if (!type) return null;
        const normalized = {...operation, type};
        normalized.id = operation.id ? String(operation.id).slice(0, 64) : undefined;
        normalized.nombre = String(operation.nombre || operation.name || 'pieza').slice(0, 64).replace(/[^a-zA-Z0-9_\- áéíóúÁÉÍÓÚñÑ]/g, '').trim() || 'pieza';
        normalized.objetivo = operation.objetivo || operation.target ? String(operation.objetivo || operation.target).slice(0, 80) : undefined;
        normalized.parentId = operation.parentId ? String(operation.parentId).slice(0, 64) : null;
        normalized.origen = vector(operation.origen || operation.origin);
        normalized.desde = vector(operation.desde || operation.from);
        normalized.hasta = vector(operation.hasta || operation.to);
        normalized.rotacion = vector(operation.rotacion || operation.rotation);
        normalized.delta = vector(operation.delta, [0, 0, 0], -32, 32);
        normalized.escala = vector(operation.escala || operation.scale, [1, 1, 1], 0.1, 4);
        return normalized;
    }

    function validateBlueprint(data) {
        if (!data || typeof data !== 'object') throw new Error('El plan de modelo no es válido.');
        if (!Array.isArray(data.operaciones)) throw new Error('El plan no contiene operaciones.');
        if (data.operaciones.length > MAX_OPERATIONS) throw new Error(`El plan supera el máximo de ${MAX_OPERATIONS} operaciones.`);
        const allowed = new Set(['crear_grupo', 'crear_cubo', 'mover', 'escalar', 'renombrar', 'eliminar']);
        const operations = data.operaciones.map(normalizeOperation).filter(Boolean);
        for (const operation of operations) {
            if (!allowed.has(operation.type)) throw new Error(`Operación no permitida: ${operation.type}`);
            if (operation.type === 'crear_cubo' && (!operation.desde || !operation.hasta)) throw new Error('Falta la geometría de un cubo.');
            if (operation.type === 'crear_grupo' && !operation.nombre) throw new Error('Falta el nombre de un grupo.');
        }
        return {
            titulo: String(data.titulo || data.title || 'Plan de modelo').slice(0, 120),
            resumen: String(data.resumen || data.summary || '').slice(0, 1000),
            estilo: String(data.estilo || data.style || '').slice(0, 200),
            operaciones: operations
        };
    }

    function findElement(identifier) {
        if (!identifier) return null;
        const value = String(identifier);
        if (typeof Cube !== 'undefined' && Array.isArray(Cube.all)) {
            const cube = Cube.all.find(item => item.uuid === value || item.name === value);
            if (cube) return cube;
        }
        if (typeof Group !== 'undefined' && Array.isArray(Group.all)) {
            const group = Group.all.find(item => item.uuid === value || item.name === value);
            if (group) return group;
        }
        return null;
    }

    function applyBlueprint(blueprint) {
        const created = [];
        const groups = new Map();
        Undo.initEdit({elements: [], outliner: true, selection: true});
        try {
            for (const operation of blueprint.operaciones.filter(item => item.type === 'crear_grupo')) {
                const group = new Group({name: operation.nombre, origin: operation.origen, rotation: operation.rotacion}).init();
                const parent = operation.parentId ? groups.get(operation.parentId) : null;
                if (parent && typeof group.addTo === 'function') group.addTo(parent);
                groups.set(operation.id || operation.nombre, group);
                created.push(group);
            }
            for (const operation of blueprint.operaciones.filter(item => item.type === 'crear_cubo')) {
                const cube = new Cube({
                    name: operation.nombre,
                    from: operation.desde,
                    to: operation.hasta,
                    origin: operation.origen,
                    rotation: operation.rotacion
                }).init();
                const parent = operation.parentId ? groups.get(operation.parentId) : null;
                if (parent && typeof cube.addTo === 'function') cube.addTo(parent);
                created.push(cube);
            }
            for (const operation of blueprint.operaciones.filter(item => !item.type.startsWith('crear_'))) {
                const target = findElement(operation.objetivo);
                if (!target) continue;
                if (operation.type === 'mover') {
                    if (Array.isArray(target.from) && Array.isArray(target.to)) {
                        for (let axis = 0; axis < 3; axis++) {
                            target.from[axis] += operation.delta[axis];
                            target.to[axis] += operation.delta[axis];
                        }
                    }
                    if (Array.isArray(target.origin)) for (let axis = 0; axis < 3; axis++) target.origin[axis] += operation.delta[axis];
                } else if (operation.type === 'escalar' && Array.isArray(target.from) && Array.isArray(target.to)) {
                    const center = target.from.map((value, axis) => (value + target.to[axis]) / 2);
                    const half = target.from.map((value, axis) => ((target.to[axis] - value) * operation.escala[axis]) / 2);
                    target.from = center.map((value, axis) => value - half[axis]);
                    target.to = center.map((value, axis) => value + half[axis]);
                } else if (operation.type === 'renombrar') {
                    target.name = operation.nombre;
                } else if (operation.type === 'eliminar' && typeof target.remove === 'function') {
                    target.remove();
                }
            }
            Canvas.updateAll();
            Undo.finishEdit(`Mikonode: ${blueprint.titulo}`);
        } catch (error) {
            try { Undo.cancelEdit(); } catch {}
            throw error;
        }
        return created;
    }

    function fallbackBlueprint(prompt) {
        const text = prompt.toLowerCase();
        let kind = 'objeto';
        if (/espada|sword/.test(text)) kind = 'espada';
        else if (/hacha|axe/.test(text)) kind = 'hacha';
        else if (/martillo|hammer/.test(text)) kind = 'martillo';
        else if (/rifle|pistola|arma|gun|weapon/.test(text)) kind = 'arma';
        else if (/casco|helmet/.test(text)) kind = 'casco';
        else if (/dragón|dragon/.test(text)) kind = 'dragon';
        const operations = [{type: 'crear_grupo', id: 'root', nombre: `mikonode_${kind}`, parentId: null, origen: [0, 0, 0]}];
        const add = (id, nombre, desde, hasta, origen = [0, 0, 0]) => operations.push({type: 'crear_cubo', id, nombre, parentId: 'root', desde, hasta, origen, rotacion: [0, 0, 0]});
        if (kind === 'espada') {
            add('mango', 'mango', [-1, -1, -1], [1, 5, 1]);
            add('guardia', 'guardia', [-4, 4, -1], [4, 6, 1], [0, 5, 0]);
            add('hoja', 'hoja', [-2, 6, -1], [2, 18, 1], [0, 6, 0]);
            add('punta', 'punta', [-1, 18, -0.7], [1, 20, 0.7], [0, 18, 0]);
        } else if (kind === 'arma') {
            add('cuerpo', 'cuerpo', [-5, 0, -2], [5, 7, 2]);
            add('cañon', 'cañon', [-1.5, 7, -1.5], [1.5, 19, 1.5], [0, 7, 0]);
            add('empuñadura', 'empunadura', [-3, -5, -1.5], [3, 1, 1.5]);
            add('culata', 'culata', [-4, -8, -2], [2, 0, 2]);
        } else if (kind === 'dragon') {
            add('cuerpo', 'cuerpo', [-6, 0, -4], [6, 10, 4]);
            add('cabeza', 'cabeza', [-5, 9, -5], [5, 16, 5], [0, 12, 0]);
            add('hocico', 'hocico', [-3, 12, -8], [3, 16, -5], [0, 13, -6]);
            add('ala_izq', 'ala_izq', [5, 7, -1], [12, 14, 1], [6, 8, 0]);
            add('ala_der', 'ala_der', [-12, 7, -1], [-5, 14, 1], [-6, 8, 0]);
            add('cola', 'cola', [-2, -8, -2], [2, 0, 2], [0, -5, 1]);
        } else if (kind === 'casco') {
            add('cascara', 'cascara', [-8, 8, -6], [8, 24, 6], [0, 16, 0]);
            add('visor', 'visor', [-6, 13, -9], [6, 16, -7], [0, 14, -8]);
        } else {
            add('cuerpo', 'cuerpo', [-5, 0, -3], [5, 10, 3]);
            add('parte_superior', 'parte_superior', [-4, 10, -2], [4, 18, 2], [0, 10, 0]);
            add('detalle', 'detalle', [-2, 18, -1], [2, 22, 1], [0, 18, 0]);
        }
        return {titulo: `Mikonode — ${kind}`, resumen: 'Plan local de respaldo para mantener el plugin usable sin una API de IA.', estilo: 'Minecraft / low-poly', operaciones};
    }

    async function callAi(mode, userText) {
        const config = getConfig();
        if (!aiConfigured()) throw new Error('La IA no está configurada. Abre Herramientas → Configuración de Mikonode.');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.max(5000, Number(config.timeoutMs) || 45000));
        try {
            const userContent = {
                tipo: 'texto',
                texto: String(userText || '').slice(0, MAX_PROMPT),
                referencia: referenceName || null,
                proyecto: summarizeProject()
            };
            if (mode === 'plan' && referenceDataUrl) userContent.imagen_base64 = referenceDataUrl;
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
                        {role: 'system', content: systemPrompt(mode)},
                        {role: 'user', content: JSON.stringify(userContent)}
                    ]
                }),
                signal: controller.signal
            });
            const body = await response.text();
            if (!response.ok) throw new Error(`La API respondió ${response.status}: ${body.slice(0, 300)}`);
            const payload = JSON.parse(body);
            const text = payload?.choices?.[0]?.message?.content;
            if (!text) throw new Error('La respuesta de la IA no contiene contenido.');
            return text;
        } finally {
            clearTimeout(timer);
        }
    }

    function analyzeLocal() {
        const summary = summarizeProject(false);
        const issues = [];
        const suggestions = [];
        if (summary.cubos === 0 && summary.mallas === 0) {
            issues.push('El proyecto todavía no tiene geometría.');
            suggestions.push('Crea una forma base antes de añadir detalles.');
        }
        if (summary.grupos === 0 && summary.cubos > 0) suggestions.push('Agrupa piezas relacionadas para facilitar la edición.');
        if (summary.texturas === 0 && summary.cubos > 0) suggestions.push('Considera añadir una textura o definir un flujo de materiales.');
        if (summary.animaciones === 0) suggestions.push('Añade animaciones cuando el modelo ya tenga una silueta estable.');
        if (summary.seleccionados === 0) suggestions.push('Selecciona una pieza para recibir recomendaciones más específicas.');
        const score = Math.max(0, Math.min(100, 100 - issues.length * 25 - Math.max(0, 3 - Math.min(summary.grupos, 3)) * 5));
        return {
            puntuacion: score,
            fortalezas: summary.cubos > 0 ? ['El modelo ya tiene geometría editable.'] : [],
            problemas: issues.map(mensaje => ({severidad: 'media', mensaje})),
            sugerencias: suggestions
        };
    }

    async function handleAnalyze() {
        if (state.busy) return;
        setBusy(true);
        try {
            if (aiConfigured()) {
                const text = await callAi('review', 'Revisa el modelo actual y dame fortalezas, problemas y sugerencias prácticas.');
                const review = parseJson(text);
                state.lastReview = review;
                addMessage('assistant', formatReview(review));
            } else {
                const review = analyzeLocal();
                state.lastReview = review;
                addMessage('assistant', formatReview(review) + '\n\nActiva la IA en la configuración de Mikonode para una revisión visual y contextual más avanzada.');
            }
        } catch (error) {
            addMessage('assistant', `No pude completar el análisis: ${error.message || error}`);
        } finally {
            setBusy(false);
        }
    }

    function formatReview(review) {
        const score = review.puntuacion ?? review.score ?? 0;
        const strengths = review.fortalezas || review.strengths || [];
        const problems = review.problemas || review.issues || [];
        const suggestions = review.sugerencias || review.suggestions || [];
        return [
            `ANÁLISIS DEL MODELO — ${score}/100`,
            '',
            `Fortalezas:\n${strengths.length ? strengths.map(item => `• ${item}`).join('\n') : '• Ninguna detectada todavía.'}`,
            '',
            `Problemas:\n${problems.length ? problems.map(item => `• ${item.mensaje || item.message}`).join('\n') : '• Ninguno detectado.'}`,
            '',
            `Sugerencias:\n${suggestions.length ? suggestions.map(item => `• ${item}`).join('\n') : '• El modelo está bien encaminado.'}`
        ].join('\n');
    }

    async function handlePrompt(prompt) {
        const trimmed = String(prompt || '').trim();
        if (!trimmed || state.busy) return;
        state.prompt = '';
        addMessage('user', trimmed);
        setBusy(true);
        try {
            const lower = trimmed.toLowerCase();
            if (/analiza|analizar|revisa|review|analyze/.test(lower)) {
                await handleAnalyze();
                return;
            }
            if (/enséñame|enseñame|teach|cómo modelo|como modelo/.test(lower)) {
                if (aiConfigured()) {
                    addMessage('assistant', await callAi('teach', trimmed));
                } else {
                    addMessage('assistant', 'Empieza siempre por la silueta, después las proporciones, luego las formas secundarias y finalmente los detalles. Mantén las piezas agrupadas y con nombres claros.');
                }
                return;
            }
            if (aiConfigured()) {
                try {
                    const text = await callAi('plan', trimmed);
                    const blueprint = validateBlueprint(parseJson(text));
                    state.lastPlan = blueprint;
                    addMessage('assistant', `He preparado un diseño: ${blueprint.titulo}\n\n${blueprint.resumen || 'Listo para revisar.'}\n\nOperaciones: ${blueprint.operaciones.length}\n\nPulsa «Aplicar plan» cuando quieras crear el modelo.`);
                    return;
                } catch (aiError) {
                    addMessage('assistant', `La IA no devolvió un plan utilizable (${aiError.message || aiError}). Usaré el modo local de respaldo.`);
                }
            }
            const fallback = validateBlueprint(fallbackBlueprint(trimmed));
            state.lastPlan = fallback;
            addMessage('assistant', `Preparé un modelo de respaldo: ${fallback.titulo}.\n\n${fallback.resumen}\n\nOperaciones: ${fallback.operaciones.length}\n\nPulsa «Aplicar plan».`);
        } catch (error) {
            addMessage('assistant', `Ocurrió un error: ${error.message || error}`);
        } finally {
            setBusy(false);
        }
    }

    function createPlanFromQuickAction(kind) {
        const prompts = {
            sword: 'Crea una espada estilo Minecraft, con empuñadura, guardia, hoja ancha y punta.',
            dragon: 'Crea un dragón estilo Minecraft con cuerpo, cabeza, cola y alas grandes.',
            weapon: 'Crea un arma futurista estilo Minecraft con cuerpo, cañón, empuñadura y culata.'
        };
        handlePrompt(prompts[kind] || 'Crea un modelo base sencillo estilo Minecraft.');
    }

    function openReferencePicker() {
        if (!imageInput) return;
        imageInput.value = '';
        imageInput.click();
    }

    function bindImagePicker() {
        if (!imageInput) return;
        imageInput.addEventListener('change', () => {
            const file = imageInput.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                referenceDataUrl = String(reader.result || '');
                referenceName = file.name;
                addMessage('assistant', `Referencia cargada: ${file.name}. Ahora puedes pedir, por ejemplo, «crea un modelo basado en esta referencia».`);
            };
            reader.readAsDataURL(file);
        });
    }

    function openSettings() {
        const config = getConfig();
        const enabled = confirm(`Mikonode — configuración de IA\n\nIA actualmente: ${config.enabled ? 'ACTIVADA' : 'DESACTIVADA'}\n\n¿Quieres editar la configuración?`);
        if (!enabled) return;
        const endpoint = prompt('Endpoint compatible con OpenAI:', config.endpoint) || config.endpoint;
        const model = prompt('Nombre del modelo:', config.model) || config.model;
        const apiKey = prompt('API key:', config.apiKey || '');
        const timeoutMs = prompt('Tiempo límite en milisegundos:', String(config.timeoutMs));
        saveConfig({
            enabled: true,
            endpoint,
            model,
            apiKey,
            timeoutMs: Number(timeoutMs) || 45000,
            sendModelSnapshot: config.sendModelSnapshot
        });
        addMessage('assistant', 'Configuración de IA guardada. La clave se almacena localmente en Blockbench.');
        renderPanel();
    }

    function panelTemplate() {
        const summary = summarizeProject(false);
        const aiLabel = aiConfigured() ? 'IA conectada' : 'Modo local';
        const referenceLabel = referenceName ? `Referencia: ${safeText(referenceName)}` : 'Sin referencia';
        const messages = state.messages.map(message => `
            <div class="mk-message mk-${message.role}">
                <div class="mk-role">${message.role === 'assistant' ? 'MIKONODE' : 'TÚ'}</div>
                <div class="mk-bubble">${safeText(message.text).replace(/\n/g, '<br>')}</div>
            </div>
        `).join('');
        return `
            <div class="mk-panel">
                <div class="mk-header">
                    <div>
                        <div class="mk-title">Mikonode</div>
                        <div class="mk-subtitle">Modela · Analiza · Aprende</div>
                    </div>
                    <div class="mk-status"><span></span>${aiLabel}</div>
                </div>
                <div class="mk-context">
                    <b>${safeText(summary.proyecto)}</b><br>
                    ${safeText(summary.formato)} · ${summary.cubos} cubos · ${summary.grupos} grupos · ${summary.seleccionados} seleccionados<br>
                    <span class="mk-reference">${referenceLabel}</span>
                </div>
                <div class="mk-messages">${messages}</div>
                <div class="mk-actions">
                    <button data-action="analyze">Analizar modelo</button>
                    <button data-action="apply" ${state.lastPlan ? '' : 'disabled'}>Aplicar plan</button>
                    <button data-action="reference">Agregar boceto</button>
                    <button data-action="settings">Configuración</button>
                </div>
                <div class="mk-quick">
                    <button data-action="sword">⚔ Espada</button>
                    <button data-action="dragon">🐉 Dragón</button>
                    <button data-action="weapon">🔧 Arma</button>
                </div>
                <div class="mk-input-wrap">
                    <textarea data-role="prompt" placeholder="Describe qué quieres modelar o cambiar...">${safeText(state.prompt)}</textarea>
                    <button class="mk-send" data-action="send" ${state.busy ? 'disabled' : ''}>➜</button>
                </div>
                <div class="mk-hint">Ejemplo: «Crea un dragón estilo Minecraft con alas grandes»</div>
            </div>
        `;
    }

    function bindPanelEvents() {
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
        root.querySelectorAll('[data-action]').forEach(button => {
            button.addEventListener('click', () => {
                const action = button.getAttribute('data-action');
                if (action === 'send') handlePrompt(input?.value || state.prompt);
                if (action === 'analyze') handleAnalyze();
                if (action === 'apply' && state.lastPlan) {
                    try {
                        const created = applyBlueprint(state.lastPlan);
                        addMessage('assistant', `Plan aplicado. Creé ${created.length} elementos en Blockbench.`);
                        state.lastPlan = null;
                    } catch (error) {
                        addMessage('assistant', `No pude aplicar el plan: ${error.message || error}`);
                    }
                    renderPanel();
                }
                if (action === 'reference') openReferencePicker();
                if (action === 'settings') openSettings();
                if (action === 'sword') createPlanFromQuickAction('sword');
                if (action === 'dragon') createPlanFromQuickAction('dragon');
                if (action === 'weapon') createPlanFromQuickAction('weapon');
            });
        });
    }

    function renderPanel() {
        if (!panel?.node) return;
        panel.node.innerHTML = panelTemplate();
        bindPanelEvents();
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
            css = Blockbench.addCSS(`
                .mk-panel { display:flex; flex-direction:column; height:100%; min-height:360px; font-size:12px; }
                .mk-header { display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid var(--color-border); }
                .mk-title { font-size:15px; font-weight:700; }
                .mk-subtitle { opacity:.6; margin-top:2px; }
                .mk-status { opacity:.72; font-size:10px; display:flex; align-items:center; gap:5px; }
                .mk-status span { width:7px; height:7px; border-radius:50%; background:#54b86b; display:inline-block; }
                .mk-context { padding:8px 10px; background:var(--color-back); border-bottom:1px solid var(--color-border); line-height:1.45; }
                .mk-reference { opacity:.55; }
                .mk-messages { flex:1; min-height:130px; overflow:auto; padding:9px; }
                .mk-message { margin-bottom:10px; }
                .mk-role { font-size:9px; letter-spacing:.08em; opacity:.52; margin:0 2px 3px; }
                .mk-bubble { border:1px solid var(--color-border); border-radius:7px; padding:8px; line-height:1.45; word-break:break-word; }
                .mk-user .mk-bubble { background:var(--color-accent); color:var(--color-accent_text); border-color:transparent; }
                .mk-actions, .mk-quick { display:flex; gap:5px; flex-wrap:wrap; padding:7px 9px; border-top:1px solid var(--color-border); }
                .mk-actions button, .mk-quick button { flex:1; min-width:90px; }
                .mk-input-wrap { display:flex; gap:6px; padding:8px 9px 4px; }
                .mk-input-wrap textarea { flex:1; min-height:58px; max-height:140px; resize:vertical; border:1px solid var(--color-border); background:var(--color-back); color:var(--color-text); border-radius:6px; padding:7px; font:inherit; }
                .mk-send { width:40px; align-self:stretch; border-radius:6px; font-size:16px; }
                .mk-hint { padding:0 10px 8px; opacity:.45; font-size:10px; }
            `);

            panel = new Panel('mikonode_panel', {
                name: 'Mikonode',
                icon: 'psychology',
                growable: true,
                resizable: true,
                default_position: {slot: 'right_bar', height: 460}
            });
            renderPanel();

            openAction = new Action('mikonode_open', {
                name: 'Mikonode',
                description: 'Abrir el asistente Mikonode',
                icon: 'psychology',
                click() { panel?.selectTab(); }
            });
            MenuBar.addAction(openAction, 'tools');

            settingsAction = new Action('mikonode_settings', {
                name: 'Configuración de Mikonode',
                description: 'Configurar la conexión de IA de Mikonode',
                icon: 'settings',
                click: openSettings
            });
            MenuBar.addAction(settingsAction, 'tools');

            imageInput = document.createElement('input');
            imageInput.type = 'file';
            imageInput.accept = 'image/png,image/jpeg,image/webp';
            imageInput.style.display = 'none';
            document.body.appendChild(imageInput);
            bindImagePicker();

            selectionListener = () => renderPanel();
            Blockbench.on('update_selection', selectionListener);
        },

        onunload() {
            if (openAction) openAction.delete();
            if (settingsAction) settingsAction.delete();
            if (panel) panel.delete();
            if (selectionListener) Blockbench.removeListener('update_selection', selectionListener);
            if (css) css.delete();
            if (imageInput) imageInput.remove();
            panel = null;
            openAction = null;
            settingsAction = null;
            selectionListener = null;
            css = null;
            imageInput = null;
            referenceDataUrl = null;
            referenceName = null;
        },

        oninstall() {
            Blockbench.showQuickMessage('Mikonode instalado correctamente');
        }
    });
})();
