/// <reference types="blockbench-types" />

(function () {
    'use strict';

    const PLUGIN_ID = 'blockbench_model_copilot';
    const VERSION = '0.2.0';
    const STORAGE_KEY = 'bbmc_ai_config_v1';
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
            text: 'Welcome. Describe a model, select an image, or ask me to analyze the current project.'
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

    function hasAiConfig() {
        const config = getConfig();
        return !!(config.enabled && config.endpoint && config.model && config.apiKey);
    }

    function safeText(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
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
        state.busy = !!value;
        renderPanel();
    }

    function summarizeProject() {
        const summary = {
            project: typeof Project !== 'undefined' && Project ? (Project.name || 'Untitled Project') : 'No project',
            format: typeof Format !== 'undefined' && Format ? (Format.id || Format.name || 'Unknown') : 'Unknown',
            cubes: typeof Cube !== 'undefined' ? Cube.all.length : 0,
            groups: typeof Group !== 'undefined' ? Group.all.length : 0,
            meshes: typeof Mesh !== 'undefined' ? Mesh.all.length : 0,
            textures: typeof Texture !== 'undefined' ? Texture.all.length : 0,
            animations: typeof Animation !== 'undefined' ? Animation.all.length : 0,
            selected: typeof OutlinerElement !== 'undefined' ? OutlinerElement.selected.length : 0
        };

        if (getConfig().sendModelSnapshot) {
            summary.elements = [];
            if (typeof Outliner !== 'undefined' && Array.isArray(Outliner.elements)) {
                for (const element of Outliner.elements.slice(0, 80)) {
                    summary.elements.push({
                        type: element.type || 'element',
                        name: element.name || 'unnamed',
                        uuid: element.uuid || null,
                        from: Array.isArray(element.from) ? element.from.slice() : undefined,
                        to: Array.isArray(element.to) ? element.to.slice() : undefined,
                        origin: Array.isArray(element.origin) ? element.origin.slice() : undefined,
                        rotation: Array.isArray(element.rotation) ? element.rotation.slice() : undefined
                    });
                }
            }
            if (typeof Group !== 'undefined' && Array.isArray(Group.all)) {
                summary.groups_detail = Group.all.slice(0, 60).map(group => ({
                    name: group.name || 'unnamed', uuid: group.uuid || null,
                    origin: Array.isArray(group.origin) ? group.origin.slice() : undefined,
                    rotation: Array.isArray(group.rotation) ? group.rotation.slice() : undefined,
                    parent: group.parent && group.parent.name ? group.parent.name : null
                }));
            }
        }
        return summary;
    }

    function makeSystemPrompt(mode) {
        const common = [
            'You are Model Copilot, an assistant for Blockbench users.',
            'Design Minecraft-friendly, editable 3D model structures.',
            'Never return executable JavaScript or arbitrary code.',
            'Use only the operation types listed in the requested schema.',
            'Keep coordinates within -64..64.',
            'Prefer simple cubes and groups that a beginner can understand.',
            'Use clear lowercase names with underscores.',
            'Prioritize silhouette and proportion before tiny details.'
        ];
        if (mode === 'plan') {
            common.push(
                'Return JSON only.',
                'Schema: {"title":string,"summary":string,"style":string,"operations":[...]}',
                'create_group: {"type":"create_group","id":string,"name":string,"parentId":string|null,"origin":[x,y,z]}',
                'create_cube: {"type":"create_cube","id":string,"name":string,"parentId":string|null,"from":[x,y,z],"to":[x,y,z],"origin":[x,y,z],"rotation":[x,y,z]}',
                'move: {"type":"move","target":string,"delta":[x,y,z]}',
                'resize: {"type":"resize","target":string,"scale":[x,y,z]}',
                'rename: {"type":"rename","target":string,"name":string}',
                'delete: {"type":"delete","target":string}',
                'Do not exceed 100 operations.'
            );
        } else if (mode === 'review') {
            common.push(
                'Return JSON only.',
                'Schema: {"score":0,"strengths":[""],"issues":[{"severity":"low|medium|high","message":""}],"suggestions":[""]}',
                'Base the review only on the supplied project snapshot.'
            );
        } else if (mode === 'teach') {
            common.push('Return concise Markdown.', 'Teach practical Blockbench modeling from silhouette to details.');
        }
        return common.join('\n');
    }

    function stripFences(text) {
        return String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    }

    function parseJsonResponse(text) {
        const cleaned = stripFences(text);
        try { return JSON.parse(cleaned); } catch {}
        const positions = ['{', '['].map(marker => {
            const index = cleaned.indexOf(marker);
            return index < 0 ? Number.POSITIVE_INFINITY : index;
        });
        const first = Math.min(...positions);
        if (!Number.isFinite(first)) throw new Error('The AI did not return JSON.');
        const last = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
        if (last <= first) throw new Error('The AI returned malformed JSON.');
        return JSON.parse(cleaned.slice(first, last + 1));
    }

    function normalizeOperation(operation) {
        if (!operation || typeof operation !== 'object' || typeof operation.type !== 'string') return null;
        const normalized = {...operation, type: operation.type.toLowerCase()};
        if (normalized.id) normalized.id = String(normalized.id).slice(0, 64);
        if (normalized.name) normalized.name = String(normalized.name).slice(0, 64).replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'part';
        if (normalized.target) normalized.target = String(normalized.target).slice(0, 80);
        if (normalized.parentId) normalized.parentId = String(normalized.parentId).slice(0, 64);
        if (['create_group', 'create_cube'].includes(normalized.type)) normalized.origin = vector(normalized.origin);
        if (normalized.type === 'create_cube') {
            normalized.from = vector(normalized.from);
            normalized.to = vector(normalized.to);
            normalized.rotation = vector(normalized.rotation);
            for (let i = 0; i < 3; i++) {
                if (normalized.from[i] > normalized.to[i]) [normalized.from[i], normalized.to[i]] = [normalized.to[i], normalized.from[i]];
            }
        }
        if (normalized.type === 'move') normalized.delta = vector(normalized.delta, [0, 0, 0], -32, 32);
        if (normalized.type === 'resize') normalized.scale = vector(normalized.scale, [1, 1, 1], 0.1, 4);
        return normalized;
    }

    function validateBlueprint(data) {
        if (!data || typeof data !== 'object') throw new Error('Blueprint is not an object.');
        if (!Array.isArray(data.operations)) throw new Error('Blueprint is missing operations.');
        if (data.operations.length > MAX_OPERATIONS) throw new Error(`Too many operations (${MAX_OPERATIONS} max).`);
        const allowed = new Set(['create_group', 'create_cube', 'move', 'resize', 'rename', 'delete']);
        const operations = data.operations.map(normalizeOperation).filter(Boolean);
        for (const operation of operations) {
            if (!allowed.has(operation.type)) throw new Error(`Unsupported operation: ${operation.type}`);
            if (operation.type === 'create_cube' && (!operation.from || !operation.to || !operation.name)) throw new Error('Invalid create_cube operation.');
            if (operation.type === 'create_group' && !operation.name) throw new Error('Invalid create_group operation.');
        }
        return {
            title: String(data.title || 'AI Model Plan').slice(0, 120),
            summary: String(data.summary || '').slice(0, 1000),
            style: String(data.style || '').slice(0, 200),
            operations
        };
    }

    function elementByNameOrId(identifier) {
        if (!identifier) return null;
        const id = String(identifier);
        if (typeof Cube !== 'undefined' && Array.isArray(Cube.all)) {
            const found = Cube.all.find(cube => cube.uuid === id || cube.name === id);
            if (found) return found;
        }
        if (typeof Group !== 'undefined' && Array.isArray(Group.all)) {
            const found = Group.all.find(group => group.uuid === id || group.name === id);
            if (found) return found;
        }
        return null;
    }

    function applyBlueprint(blueprint) {
        const created = [];
        const groups = new Map();
        Undo.initEdit({elements: [], outliner: true, selection: true});
        try {
            for (const operation of blueprint.operations.filter(item => item.type === 'create_group')) {
                const group = new Group({name: operation.name, origin: operation.origin, rotation: [0, 0, 0]}).init();
                const parent = operation.parentId ? groups.get(String(operation.parentId)) : null;
                if (parent && typeof group.addTo === 'function') group.addTo(parent);
                groups.set(operation.id || operation.name, group);
                created.push(group);
            }
            for (const operation of blueprint.operations.filter(item => item.type === 'create_cube')) {
                const cube = new Cube({name: operation.name, from: operation.from, to: operation.to, origin: operation.origin, rotation: operation.rotation}).init();
                const parent = operation.parentId ? groups.get(String(operation.parentId)) : null;
                if (parent && typeof cube.addTo === 'function') cube.addTo(parent);
                created.push(cube);
            }
            for (const operation of blueprint.operations) {
                if (operation.type.startsWith('create_')) continue;
                const target = elementByNameOrId(operation.target);
                if (!target) continue;
                if (operation.type === 'move') {
                    if (Array.isArray(target.from) && Array.isArray(target.to)) for (let axis = 0; axis < 3; axis++) { target.from[axis] += operation.delta[axis]; target.to[axis] += operation.delta[axis]; }
                    if (Array.isArray(target.origin)) for (let axis = 0; axis < 3; axis++) target.origin[axis] += operation.delta[axis];
                } else if (operation.type === 'resize' && Array.isArray(target.from) && Array.isArray(target.to)) {
                    const center = target.from.map((value, axis) => (value + target.to[axis]) / 2);
                    const half = target.from.map((value, axis) => ((target.to[axis] - value) * operation.scale[axis]) / 2);
                    target.from = center.map((value, axis) => value - half[axis]);
                    target.to = center.map((value, axis) => value + half[axis]);
                } else if (operation.type === 'rename') {
                    target.name = operation.name || target.name;
                } else if (operation.type === 'delete' && typeof target.remove === 'function') {
                    target.remove();
                }
            }
            Canvas.updateAll();
            Undo.finishEdit(`Apply AI model plan: ${blueprint.title}`);
        } catch (error) {
            try { Undo.cancelEdit(); } catch {}
            throw error;
        }
        return created;
    }

    function fallbackBlueprint(prompt) {
        const text = prompt.toLowerCase();
        let kind = 'creature';
        if (/sword|espada/.test(text)) kind = 'sword';
        else if (/hammer|martillo/.test(text)) kind = 'hammer';
        else if (/axe|hacha/.test(text)) kind = 'axe';
        else if (/rifle|gun|pistol|weapon|arma/.test(text)) kind = 'weapon';
        else if (/helmet|casco/.test(text)) kind = 'helmet';
        else if (/dragon|dragón/.test(text)) kind = 'dragon';

        const operations = [{type: 'create_group', id: 'root', name: `copilot_${kind}`, parentId: null, origin: [0, 0, 0]}];
        const add = (id, name, from, to, origin = [0, 0, 0]) => operations.push({type: 'create_cube', id, name, parentId: 'root', from, to, origin, rotation: [0, 0, 0]});
        if (kind === 'sword') {
            add('handle', 'handle', [-1, -1, -1], [1, 5, 1]);
            add('guard', 'guard', [-4, 4, -1], [4, 6, 1], [0, 5, 0]);
            add('blade', 'blade', [-2, 6, -1], [2, 18, 1], [0, 6, 0]);
            add('tip', 'tip', [-1, 18, -0.7], [1, 20, 0.7], [0, 18, 0]);
        } else if (kind === 'weapon') {
            add('receiver', 'receiver', [-5, 0, -2], [5, 7, 2]);
            add('barrel', 'barrel', [-1.5, 7, -1.5], [1.5, 19, 1.5], [0, 7, 0]);
            add('grip', 'grip', [-3, -5, -1.5], [3, 1, 1.5]);
            add('stock', 'stock', [-4, -8, -2], [2, 0, 2]);
        } else if (kind === 'dragon') {
            add('body', 'body', [-6, 0, -4], [6, 10, 4]);
            add('head', 'head', [-5, 9, -5], [5, 16, 5], [0, 12, 0]);
            add('snout', 'snout', [-3, 12, -8], [3, 16, -5], [0, 13, -6]);
            add('tail', 'tail', [-2, -8, 0], [2, 3, 8]);
            add('wing_left', 'wing_left', [5, 4, 0], [12, 10, 2], [5, 7, 0]);
            add('wing_right', 'wing_right', [-12, 4, 0], [-5, 10, 2], [-5, 7, 0]);
        } else if (kind === 'helmet') {
            add('shell', 'shell', [-8, 8, -6], [8, 24, 6], [0, 16, 0]);
            add('visor', 'visor', [-6, 13, -9], [6, 16, -7], [0, 14, -8]);
        } else {
            add('body', 'body', [-5, 0, -3], [5, 10, 3]);
            add('top', 'top', [-4, 10, -2], [4, 18, 2], [0, 10, 0]);
            add('detail', 'detail', [-2, 18, -1], [2, 22, 1], [0, 18, 0]);
        }
        return validateBlueprint({title: `${kind.charAt(0).toUpperCase()}${kind.slice(1)} starter`, summary: 'Offline fallback plan. Configure an AI provider for natural-language model planning.', style: 'Minecraft / blocky', operations});
    }

    async function callAi(messages, temperature = 0.2) {
        const config = getConfig();
        if (!hasAiConfig()) throw new Error('AI is not configured. Open AI Settings and add an endpoint, model, and API key.');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.max(5000, config.timeoutMs));
        try {
            const response = await fetch(config.endpoint, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}`},
                body: JSON.stringify({model: config.model, temperature, messages}),
                signal: controller.signal
            });
            const raw = await response.text();
            if (!response.ok) throw new Error(`AI request failed (${response.status}): ${raw.slice(0, 500)}`);
            const payload = JSON.parse(raw);
            const content = payload?.choices?.[0]?.message?.content;
            if (!content) throw new Error('AI provider returned no message content.');
            return String(content);
        } catch (error) {
            if (error.name === 'AbortError') throw new Error('AI request timed out.');
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    async function createPlan(prompt) {
        if (!hasAiConfig()) return fallbackBlueprint(prompt);
        const contentText = `Task: ${prompt}\nCreate an editable Blockbench model plan. Return JSON matching the schema.\nCurrent project snapshot: ${JSON.stringify(summarizeProject())}`;
        const messages = [{role: 'system', content: makeSystemPrompt('plan')}];
        if (referenceDataUrl) {
            messages.push({role: 'user', content: [
                {type: 'text', text: `${contentText}\nA reference image is attached. Use it as a visual guide, but keep the model blocky and editable.`},
                {type: 'image_url', image_url: {url: referenceDataUrl}}
            ]});
        } else {
            messages.push({role: 'user', content: contentText});
        }
        return validateBlueprint(parseJsonResponse(await callAi(messages)));
    }

    async function handleGenerate() {
        const prompt = state.prompt.trim();
        if (!prompt || state.busy) return;
        if (prompt.length > MAX_PROMPT) { addMessage('assistant', `Please keep the prompt under ${MAX_PROMPT} characters.`); return; }
        addMessage('user', prompt);
        setBusy(true);
        try {
            const plan = await createPlan(prompt);
            state.lastPlan = plan;
            addMessage('assistant', `${plan.title}\n\n${plan.summary || 'Plan ready.'}\n\n${plan.operations.length} safe model operations prepared.\n\nPress “Apply Plan” to create it in Blockbench.`);
        } catch (error) {
            addMessage('assistant', `I couldn't create the plan: ${error.message || error}`);
        } finally {
            state.prompt = '';
            setBusy(false);
        }
    }

    function applyLastPlan() {
        if (!state.lastPlan) { addMessage('assistant', 'Generate a plan first.'); return; }
        try {
            const created = applyBlueprint(state.lastPlan);
            addMessage('assistant', `Applied ${created.length} model parts from “${state.lastPlan.title}”. You can undo the change with Blockbench Undo.`);
        } catch (error) {
            addMessage('assistant', `I could not apply the plan: ${error.message || error}`);
        }
    }

    function fallbackReview() {
        const summary = summarizeProject();
        const issues = [];
        const suggestions = [];
        if (summary.cubes === 0 && summary.meshes === 0) issues.push({severity: 'high', message: 'No geometry is present yet.'});
        if (summary.cubes > 0 && summary.groups === 0) suggestions.push('Group related parts to keep the model easier to edit.');
        if (summary.textures === 0 && summary.cubes > 0) suggestions.push('Consider a texture workflow once the silhouette is finished.');
        if (summary.animations === 0) suggestions.push('Add animation only after the model proportions are stable.');
        return {score: Math.max(0, Math.min(100, 100 - issues.length * 25)), strengths: summary.cubes > 0 ? ['The project contains editable cube geometry.'] : [], issues, suggestions};
    }

    async function reviewModel() {
        if (!hasAiConfig()) return fallbackReview();
        const snapshot = summarizeProject();
        return JSON.parse(stripFences(await callAi([
            {role: 'system', content: makeSystemPrompt('review')},
            {role: 'user', content: `Review this Blockbench project snapshot:\n${JSON.stringify(snapshot)}`}
        ], 0.1)));
    }

    async function handleAnalyze() {
        if (state.busy) return;
        setBusy(true);
        try {
            const review = await reviewModel();
            state.lastReview = review;
            const strengths = Array.isArray(review.strengths) ? review.strengths.map(item => `• ${item}`).join('\n') : '• None listed';
            const issues = Array.isArray(review.issues) ? review.issues.map(item => `• [${item.severity || 'info'}] ${item.message || item}`).join('\n') : '• None listed';
            const suggestions = Array.isArray(review.suggestions) ? review.suggestions.map(item => `• ${item}`).join('\n') : '• None listed';
            addMessage('assistant', `MODEL REVIEW — ${clampNumber(review.score, 0, 100) ?? 0}/100\n\nStrengths:\n${strengths}\n\nIssues:\n${issues}\n\nSuggestions:\n${suggestions}`);
        } catch (error) {
            addMessage('assistant', `Review failed: ${error.message || error}`);
        } finally {
            setBusy(false);
        }
    }

    async function handleTeach() {
        if (state.busy) return;
        const prompt = state.prompt.trim() || 'Teach me a good workflow for building a Minecraft model in Blockbench.';
        addMessage('user', prompt);
        setBusy(true);
        try {
            if (!hasAiConfig()) {
                addMessage('assistant', 'Start with silhouette → proportions → secondary forms → details → texture → animation. Keep related pieces grouped and name them clearly as you work.');
            } else {
                const lesson = await callAi([{role: 'system', content: makeSystemPrompt('teach')}, {role: 'user', content: prompt}], 0.3);
                addMessage('assistant', lesson);
            }
        } catch (error) {
            addMessage('assistant', `Teaching request failed: ${error.message || error}`);
        } finally {
            state.prompt = '';
            setBusy(false);
        }
    }

    function openReferencePicker() {
        if (!imageInput) {
            imageInput = document.createElement('input');
            imageInput.type = 'file';
            imageInput.accept = 'image/*';
            imageInput.style.display = 'none';
            imageInput.addEventListener('change', event => {
                const file = event.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                    referenceDataUrl = String(reader.result || '');
                    referenceName = file.name;
                    addMessage('assistant', `Reference loaded: ${referenceName}. It will be attached to the next AI generation.`);
                    renderPanel();
                };
                reader.readAsDataURL(file);
            });
            document.body.appendChild(imageInput);
        }
        imageInput.click();
    }

    function removeReference() {
        referenceDataUrl = null;
        referenceName = null;
        if (imageInput) imageInput.value = '';
        renderPanel();
    }

    function openSettings() {
        const config = getConfig();
        const dialog = new Dialog('bbmc_ai_settings', {
            title: 'Model Copilot — AI Settings', width: 520,
            form: {
                enabled: {label: 'Enable AI', type: 'checkbox', value: config.enabled},
                endpoint: {label: 'OpenAI-compatible endpoint', type: 'text', value: config.endpoint},
                model: {label: 'Model', type: 'text', value: config.model},
                apiKey: {label: 'API key', type: 'password', value: config.apiKey},
                timeoutMs: {label: 'Timeout (ms)', type: 'number', value: config.timeoutMs},
                sendModelSnapshot: {label: 'Send model structure to AI', type: 'checkbox', value: config.sendModelSnapshot}
            },
            buttons: ['Save', 'Cancel'], confirmIndex: 0, cancelIndex: 1,
            onConfirm(result) {
                saveConfig({
                    enabled: !!result.enabled,
                    endpoint: String(result.endpoint || '').trim(),
                    model: String(result.model || '').trim(),
                    apiKey: String(result.apiKey || '').trim(),
                    timeoutMs: Math.max(5000, Number(result.timeoutMs) || 45000),
                    sendModelSnapshot: result.sendModelSnapshot !== false
                });
                addMessage('assistant', hasAiConfig() ? 'AI provider configured. Natural-language planning, reviews, teaching, and image references are enabled.' : 'AI is disabled. Offline fallback mode remains available.');
                renderPanel();
            }
        });
        dialog.show();
    }

    function renderPanel() {
        if (!panel || !panel.node) return;
        const status = hasAiConfig() ? 'AI READY' : 'OFFLINE FALLBACK';
        const summary = summarizeProject();
        const reference = referenceName ? `<div class="bbmc-reference">📎 ${safeText(referenceName)} <button data-action="remove-reference">×</button></div>` : '';
        const messages = state.messages.map(message => `
            <div class="bbmc-message bbmc-${message.role}">
                <div class="bbmc-role">${message.role === 'assistant' ? 'COPILOT' : 'YOU'}</div>
                <div class="bbmc-bubble">${safeText(message.text).replace(/\n/g, '<br>')}</div>
            </div>
        `).join('');

        panel.node.innerHTML = `
            <div class="bbmc-panel">
                <div class="bbmc-header">
                    <div><div class="bbmc-title">Model Copilot <span class="bbmc-version">v${VERSION}</span></div><div class="bbmc-subtitle">Create · Edit · Review · Learn</div></div>
                    <div class="bbmc-status"><span></span>${status}</div>
                </div>
                <div class="bbmc-context"><strong>${safeText(summary.project)}</strong><span>${safeText(summary.format)} · ${summary.cubes} cubes · ${summary.groups} groups · ${summary.textures} textures · ${summary.selected} selected</span></div>
                <div class="bbmc-messages">${messages}</div>
                ${reference}
                <div class="bbmc-plan-actions">
                    <button data-action="apply-plan" ${state.lastPlan && !state.busy ? '' : 'disabled'}>Apply Plan</button>
                    <button data-action="analyze" ${state.busy ? 'disabled' : ''}>Analyze</button>
                    <button data-action="teach" ${state.busy ? 'disabled' : ''}>Teach Me</button>
                </div>
                <div class="bbmc-input-wrap"><textarea data-role="prompt" placeholder="Describe a model or change...">${safeText(state.prompt)}</textarea><button class="bbmc-send" data-action="generate" ${state.busy ? 'disabled' : ''}>${state.busy ? '…' : '➜'}</button></div>
                <div class="bbmc-tools"><button data-action="reference" ${state.busy ? 'disabled' : ''}>📎 Reference</button><button data-action="settings">⚙ AI Settings</button><button data-action="clear">Clear chat</button></div>
                <div class="bbmc-hint">${hasAiConfig() ? 'AI requests use your configured provider. API keys stay in Blockbench local storage.' : 'Offline mode works without an API key. Configure AI Settings for natural-language generation.'}</div>
            </div>`;
        bindPanelEvents();
        const messagesNode = panel.node.querySelector('.bbmc-messages');
        if (messagesNode) messagesNode.scrollTop = messagesNode.scrollHeight;
    }

    function bindPanelEvents() {
        const promptNode = panel.node.querySelector('[data-role="prompt"]');
        if (promptNode) {
            promptNode.addEventListener('input', event => { state.prompt = event.target.value; });
            promptNode.addEventListener('keydown', event => {
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleGenerate(); }
            });
        }
        panel.node.querySelectorAll('[data-action]').forEach(button => {
            button.addEventListener('click', () => {
                const action = button.dataset.action;
                if (action === 'generate') handleGenerate();
                else if (action === 'apply-plan') applyLastPlan();
                else if (action === 'analyze') handleAnalyze();
                else if (action === 'teach') handleTeach();
                else if (action === 'reference') openReferencePicker();
                else if (action === 'remove-reference') removeReference();
                else if (action === 'settings') openSettings();
                else if (action === 'clear') { state.messages = [{role: 'assistant', text: 'Chat cleared. Describe a model or ask about the current project.'}]; state.lastPlan = null; renderPanel(); }
            });
        });
    }

    Plugin.register(PLUGIN_ID, {
        title: 'Blockbench Model Copilot',
        author: 'Sbtxx',
        description: 'AI-assisted modeling inside Blockbench: text and reference driven planning, safe model operations, reviews, and learning.',
        icon: 'psychology', version: VERSION, variant: 'both', min_version: '5.0.0',
        tags: ['Minecraft', 'Utility'],
        repository: 'https://github.com/Sbtxx/blockbench-model-copilot',
        website: 'https://github.com/Sbtxx/blockbench-model-copilot',
        onload() {
            css = Blockbench.addCSS(`
                .bbmc-panel{display:flex;flex-direction:column;height:100%;min-height:360px;font-size:12px}
                .bbmc-header{display:flex;justify-content:space-between;align-items:center;padding:10px;border-bottom:1px solid var(--color-border);gap:8px}
                .bbmc-title{font-size:14px;font-weight:700}.bbmc-version{font-size:9px;opacity:.45;font-weight:400}
                .bbmc-subtitle{opacity:.62;margin-top:2px}.bbmc-status{opacity:.72;font-size:10px;display:flex;align-items:center;gap:5px;white-space:nowrap}
                .bbmc-status span{width:7px;height:7px;border-radius:50%;background:#54b86b;display:inline-block}
                .bbmc-context{display:flex;flex-direction:column;gap:2px;padding:8px 10px;background:var(--color-back);border-bottom:1px solid var(--color-border);line-height:1.4}
                .bbmc-context span{opacity:.52;font-size:10px}.bbmc-messages{flex:1;min-height:130px;overflow:auto;padding:9px}
                .bbmc-message{margin-bottom:10px}.bbmc-role{font-size:9px;letter-spacing:.08em;opacity:.52;margin:0 2px 3px}
                .bbmc-bubble{border:1px solid var(--color-border);border-radius:7px;padding:8px;line-height:1.45;word-break:break-word}
                .bbmc-user .bbmc-bubble{background:var(--color-accent);color:var(--color-accent_text);border-color:transparent}
                .bbmc-plan-actions,.bbmc-tools{display:flex;gap:5px;flex-wrap:wrap;padding:6px 9px;border-top:1px solid var(--color-border)}
                .bbmc-plan-actions button,.bbmc-tools button{flex:1;min-width:78px}.bbmc-input-wrap{display:flex;gap:6px;padding:7px 9px 4px}
                .bbmc-input-wrap textarea{flex:1;min-height:58px;max-height:150px;resize:vertical;border:1px solid var(--color-border);background:var(--color-back);color:var(--color-text);border-radius:6px;padding:7px;font:inherit}
                .bbmc-send{width:40px;align-self:stretch;border-radius:6px;font-size:16px}.bbmc-reference{display:flex;align-items:center;gap:6px;margin:0 9px 6px;padding:6px 8px;border:1px solid var(--color-border);border-radius:6px;background:var(--color-back)}
                .bbmc-reference button{margin-left:auto;min-width:22px}.bbmc-hint{padding:2px 10px 8px;opacity:.45;font-size:10px;line-height:1.35}
            `);
            panel = new Panel('blockbench_model_copilot_panel', {name:'Model Copilot', icon:'psychology', growable:true, resizable:true, default_position:{slot:'right_bar', height:460}});
            openAction = new Action('blockbench_model_copilot_open', {name:'Model Copilot', description:'Open the Blockbench Model Copilot panel', icon:'psychology', click(){ if(panel) panel.selectTab(); }});
            MenuBar.addAction(openAction, 'tools');
            settingsAction = new Action('blockbench_model_copilot_settings', {name:'Model Copilot Settings', description:'Configure the AI provider', icon:'settings', click:openSettings});
            MenuBar.addAction(settingsAction, 'tools');
            selectionListener = () => renderPanel();
            Blockbench.on('update_selection', selectionListener);
            renderPanel();
        },
        onunload() {
            if(openAction) openAction.delete(); if(settingsAction) settingsAction.delete(); if(panel) panel.delete();
            if(selectionListener) Blockbench.removeListener('update_selection', selectionListener); if(imageInput && imageInput.remove) imageInput.remove(); if(css) css.delete();
            panel=null; openAction=null; settingsAction=null; selectionListener=null; imageInput=null; css=null;
        },
        oninstall(){ Blockbench.showQuickMessage('Blockbench Model Copilot installed'); }
    });
})();
