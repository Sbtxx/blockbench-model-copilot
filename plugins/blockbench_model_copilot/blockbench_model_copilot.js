/// <reference types="blockbench-types" />

(function () {
    'use strict';

    const PLUGIN_ID = 'blockbench_model_copilot';
    const VERSION = '0.1.0';

    let panel;
    let openAction;
    let selectionListener;
    let css;

    const state = {
        prompt: '',
        messages: [
            {
                role: 'assistant',
                text: 'Hi! I\'m Model Copilot. Describe a model or ask me what to do with the current selection.'
            }
        ],
        lastAnalysis: null,
        busy: false
    };

    function safeText(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        })[character]);
    }

    function addMessage(role, text) {
        state.messages.push({role, text});
        if (state.messages.length > 30) state.messages.shift();
        renderPanel();
    }

    function currentModelSummary() {
        return {
            project: typeof Project !== 'undefined' && Project ? (Project.name || 'Untitled Project') : 'No project',
            format: typeof Format !== 'undefined' && Format ? (Format.id || Format.name || 'Unknown') : 'Unknown',
            cubes: typeof Cube !== 'undefined' ? Cube.all.length : 0,
            groups: typeof Group !== 'undefined' ? Group.all.length : 0,
            meshes: typeof Mesh !== 'undefined' ? Mesh.all.length : 0,
            textures: typeof Texture !== 'undefined' ? Texture.all.length : 0,
            animations: typeof Animation !== 'undefined' ? Animation.all.length : 0,
            selected: typeof OutlinerElement !== 'undefined' ? OutlinerElement.selected.length : 0
        };
    }

    function analyzeModel() {
        const summary = currentModelSummary();
        const issues = [];
        const suggestions = [];

        if (!summary.project || summary.project === 'No project') {
            issues.push('No active project is open.');
        }
        if (summary.cubes === 0 && summary.meshes === 0) {
            issues.push('The project has no visible geometry yet.');
            suggestions.push('Create a base shape before adding details.');
        }
        if (summary.groups === 0 && summary.cubes > 0) {
            suggestions.push('Group related parts to make the model easier to edit.');
        }
        if (summary.textures === 0 && summary.cubes > 0) {
            suggestions.push('Consider adding a texture or using a clearly defined material workflow.');
        }
        if (summary.animations === 0) {
            suggestions.push('Add animations later if the model needs movement.');
        }
        if (summary.selected === 0) {
            suggestions.push('Select a cube or group to receive more targeted suggestions.');
        }

        const score = Math.max(0, Math.min(100,
            100 - issues.length * 20 - Math.max(0, 3 - Math.min(summary.groups, 3)) * 5
        ));

        state.lastAnalysis = {summary, issues, suggestions, score};
        return state.lastAnalysis;
    }

    function formatAnalysis(analysis) {
        const {summary, issues, suggestions, score} = analysis;
        return [
            `MODEL HEALTH — ${score}/100`,
            '',
            `Project: ${summary.project}`,
            `Format: ${summary.format}`,
            `Cubes: ${summary.cubes}  |  Groups: ${summary.groups}`,
            `Meshes: ${summary.meshes}  |  Textures: ${summary.textures}`,
            `Animations: ${summary.animations}  |  Selected: ${summary.selected}`,
            '',
            issues.length ? `Issues:\n${issues.map(item => `• ${item}`).join('\n')}` : 'Issues:\n• None detected by the MVP analyzer.',
            '',
            suggestions.length ? `Suggestions:\n${suggestions.map(item => `• ${item}`).join('\n')}` : 'Suggestions:\n• Looks good for this stage.'
        ].join('\n');
    }

    function selectedCubes() {
        return typeof Cube !== 'undefined' ? Cube.selected : [];
    }

    function modifySelection(command) {
        const cubes = selectedCubes();
        if (!cubes.length) {
            addMessage('assistant', 'Select at least one cube first.');
            return;
        }

        const normalized = command.toLowerCase();
        let changed = false;
        let editName = 'Copilot selection edit';

        if (/larger|bigger|scale up|increase size/.test(normalized)) {
            Undo.initEdit({elements: cubes});
            cubes.forEach(cube => {
                const center = [
                    (cube.from[0] + cube.to[0]) / 2,
                    (cube.from[1] + cube.to[1]) / 2,
                    (cube.from[2] + cube.to[2]) / 2
                ];
                const size = [
                    (cube.to[0] - cube.from[0]) * 1.1,
                    (cube.to[1] - cube.from[1]) * 1.1,
                    (cube.to[2] - cube.from[2]) * 1.1
                ];
                cube.from = [center[0] - size[0] / 2, center[1] - size[1] / 2, center[2] - size[2] / 2];
                cube.to = [center[0] + size[0] / 2, center[1] + size[1] / 2, center[2] + size[2] / 2];
            });
            changed = true;
            editName = 'Scale selected cubes up';
        } else if (/smaller|reduce|scale down|decrease size/.test(normalized)) {
            Undo.initEdit({elements: cubes});
            cubes.forEach(cube => {
                const center = [
                    (cube.from[0] + cube.to[0]) / 2,
                    (cube.from[1] + cube.to[1]) / 2,
                    (cube.from[2] + cube.to[2]) / 2
                ];
                const size = [
                    (cube.to[0] - cube.from[0]) * 0.9,
                    (cube.to[1] - cube.from[1]) * 0.9,
                    (cube.to[2] - cube.from[2]) * 0.9
                ];
                cube.from = [center[0] - size[0] / 2, center[1] - size[1] / 2, center[2] - size[2] / 2];
                cube.to = [center[0] + size[0] / 2, center[1] + size[1] / 2, center[2] + size[2] / 2];
            });
            changed = true;
            editName = 'Scale selected cubes down';
        } else if (/move left|shift left/.test(normalized)) {
            Undo.initEdit({elements: cubes});
            cubes.forEach(cube => { cube.from[0] -= 1; cube.to[0] -= 1; });
            changed = true;
            editName = 'Move selected cubes left';
        } else if (/move right|shift right/.test(normalized)) {
            Undo.initEdit({elements: cubes});
            cubes.forEach(cube => { cube.from[0] += 1; cube.to[0] += 1; });
            changed = true;
            editName = 'Move selected cubes right';
        } else if (/move up|raise|lift/.test(normalized)) {
            Undo.initEdit({elements: cubes});
            cubes.forEach(cube => { cube.from[1] += 1; cube.to[1] += 1; });
            changed = true;
            editName = 'Move selected cubes up';
        } else if (/move down|lower/.test(normalized)) {
            Undo.initEdit({elements: cubes});
            cubes.forEach(cube => { cube.from[1] -= 1; cube.to[1] -= 1; });
            changed = true;
            editName = 'Move selected cubes down';
        }

        if (!changed) return false;

        Canvas.updateView({
            elements: cubes,
            element_aspects: {geometry: true, transform: true},
            selection: true
        });
        Undo.finishEdit(editName);
        addMessage('assistant', `Done. I applied “${editName.toLowerCase()}” to ${cubes.length} selected cube${cubes.length === 1 ? '' : 's'}.`);
        return true;
    }

    function createStarterModel(prompt) {
        if (typeof Cube === 'undefined' || typeof Group === 'undefined') {
            addMessage('assistant', 'The current Blockbench context does not expose the model API needed for generation.');
            return;
        }

        const text = prompt.toLowerCase();
        let kind = 'generic';
        if (text.includes('sword') || text.includes('espada')) kind = 'sword';
        else if (text.includes('axe') || text.includes('hacha')) kind = 'axe';
        else if (text.includes('hammer') || text.includes('martillo')) kind = 'hammer';
        else if (text.includes('gun') || text.includes('rifle') || text.includes('pistol') || text.includes('arma')) kind = 'weapon';
        else if (text.includes('helmet') || text.includes('casco')) kind = 'helmet';

        const root = new Group({name: `copilot_${kind}`, origin: [0, 0, 0]}).init();
        const cubes = [];

        function addCube(name, from, to, origin) {
            const cube = new Cube({name, from, to, origin: origin || [0, 0, 0]}).init();
            cube.addTo(root);
            cubes.push(cube);
        }

        if (kind === 'sword') {
            addCube('handle', [-1, -1, -1], [1, 5, 1], [0, 0, 0]);
            addCube('guard', [-4, 4, -1], [4, 6, 1], [0, 5, 0]);
            addCube('blade', [-2, 6, -0.75], [2, 18, 0.75], [0, 6, 0]);
            addCube('tip', [-1, 18, -0.65], [1, 20, 0.65], [0, 18, 0]);
        } else if (kind === 'axe') {
            addCube('handle', [-1, 0, -1], [1, 18, 1], [0, 0, 0]);
            addCube('head', [1, 13, -3], [8, 18, 3], [1, 14, 0]);
        } else if (kind === 'hammer') {
            addCube('handle', [-1, 0, -1], [1, 18, 1], [0, 0, 0]);
            addCube('head', [-5, 14, -3], [5, 19, 3], [0, 16, 0]);
        } else if (kind === 'weapon') {
            addCube('receiver', [-5, 0, -2], [5, 7, 2], [0, 0, 0]);
            addCube('barrel', [-1.5, 7, -1.5], [1.5, 18, 1.5], [0, 7, 0]);
            addCube('grip', [-3, -5, -1.5], [3, 1, 1.5], [0, 0, 0]);
            addCube('stock', [-4, -8, -2], [2, 0, 2], [0, 0, 0]);
        } else if (kind === 'helmet') {
            addCube('shell', [-8, 8, -6], [8, 24, 6], [0, 16, 0]);
            addCube('front_guard', [-8, 10, -8], [8, 15, -6], [0, 12, -7]);
            addCube('visor', [-6, 13, -9], [6, 16, -7], [0, 14, -8]);
        } else {
            addCube('body', [-5, 0, -3], [5, 10, 3], [0, 0, 0]);
            addCube('top', [-4, 10, -2], [4, 18, 2], [0, 10, 0]);
            addCube('detail', [-2, 18, -1], [2, 22, 1], [0, 18, 0]);
        }

        Undo.initEdit({elements: cubes});
        Undo.finishEdit(`Create Copilot ${kind} starter model`);
        Canvas.updateAll();

        addMessage('assistant', `I created a ${kind} starter model with ${cubes.length} parts. It is intentionally simple so you can continue editing it in Blockbench.`);
    }

    function teach(prompt) {
        const text = prompt.toLowerCase();
        let lesson;
        if (text.includes('sword') || text.includes('espada')) {
            lesson = 'Start with 4 parts: handle, guard, blade, and tip. Keep each part in its own cube so proportions stay easy to edit. Use the Outliner to name them clearly, then refine the silhouette before adding small details.';
        } else if (text.includes('gun') || text.includes('rifle') || text.includes('arma')) {
            lesson = 'For a readable Minecraft-style weapon, block out the receiver first, then barrel, grip, and stock. Check the silhouette from front and side views before adding scopes, rails, or small details.';
        } else {
            lesson = 'Blockbench works best when you build from large shapes to small details: 1) silhouette, 2) proportions, 3) secondary forms, 4) details, 5) texture, 6) animation. Keep parts grouped and named as you go.';
        }
        addMessage('assistant', lesson);
    }

    function handlePrompt(prompt) {
        const trimmed = prompt.trim();
        if (!trimmed || state.busy) return;

        state.prompt = '';
        addMessage('user', trimmed);
        state.busy = true;

        try {
            const normalized = trimmed.toLowerCase();
            if (normalized.includes('analyze') || normalized.includes('analiza') || normalized.includes('review') || normalized.includes('revisa')) {
                addMessage('assistant', formatAnalysis(analyzeModel()));
            } else if (normalized.includes('teach') || normalized.includes('enseña') || normalized.includes('how do i model') || normalized.includes('como modelo')) {
                teach(trimmed);
            } else if (normalized.includes('create') || normalized.includes('crear') || normalized.includes('generate') || normalized.includes('genera')) {
                createStarterModel(trimmed);
            } else if (!modifySelection(trimmed)) {
                addMessage('assistant', 'I can currently create starter models, analyze the current project, teach modeling workflows, or modify selected cubes with simple commands like “make it bigger”, “move left”, or “move up”.\n\nThis is the offline MVP; the AI provider layer will be added next.');
            }
        } catch (error) {
            console.error(`[${PLUGIN_ID}]`, error);
            addMessage('assistant', `I hit an error while processing that request: ${error.message || error}`);
        } finally {
            state.busy = false;
            renderPanel();
        }
    }

    function panelTemplate() {
        const messages = state.messages.map(message => `
            <div class="bbmc-message bbmc-${message.role}">
                <div class="bbmc-role">${message.role === 'assistant' ? 'COPILOT' : 'YOU'}</div>
                <div class="bbmc-bubble">${safeText(message.text).replace(/\n/g, '<br>')}</div>
            </div>
        `).join('');

        const summary = currentModelSummary();

        return `
            <div class="bbmc-panel">
                <div class="bbmc-header">
                    <div>
                        <div class="bbmc-title">Model Copilot</div>
                        <div class="bbmc-subtitle">Create · Analyze · Learn</div>
                    </div>
                    <div class="bbmc-status"><span></span> Offline MVP</div>
                </div>

                <div class="bbmc-context">
                    <div><b>${safeText(summary.project)}</b></div>
                    <div>${safeText(summary.format)} · ${summary.cubes} cubes · ${summary.groups} groups · ${summary.selected} selected</div>
                </div>

                <div class="bbmc-messages">${messages}</div>

                <div class="bbmc-quick-actions">
                    <button data-action="analyze">Analyze Model</button>
                    <button data-action="starter">Create Starter</button>
                    <button data-action="teach">Teach Me</button>
                </div>

                <div class="bbmc-input-wrap">
                    <textarea data-role="prompt" placeholder="Describe a model or tell Copilot what to change...">${safeText(state.prompt)}</textarea>
                    <button class="bbmc-send" data-action="send" title="Send">➜</button>
                </div>
                <div class="bbmc-hint">Try: “create a sword” · “make it bigger” · “analyze my model”</div>
            </div>
        `;
    }

    function bindPanelEvents() {
        if (!panel || !panel.node) return;
        const root = panel.node.querySelector('.bbmc-panel');
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
                if (action === 'send') handlePrompt(input ? input.value : state.prompt);
                if (action === 'analyze') handlePrompt('analyze my model');
                if (action === 'starter') handlePrompt('create a generic starter model');
                if (action === 'teach') handlePrompt('teach me how to model');
            });
        });
    }

    function renderPanel() {
        if (!panel || !panel.node) return;
        panel.node.innerHTML = panelTemplate();
        bindPanelEvents();
        const messages = panel.node.querySelector('.bbmc-messages');
        if (messages) messages.scrollTop = messages.scrollHeight;
    }

    Plugin.register(PLUGIN_ID, {
        title: 'Blockbench Model Copilot',
        author: 'Sbtxx',
        description: 'An in-Blockbench assistant for creating, editing, analyzing, and learning 3D modeling.',
        icon: 'psychology',
        version: VERSION,
        variant: 'both',
        min_version: '4.8.0',
        tags: ['Minecraft', 'Utility'],

        onload() {
            css = Blockbench.addCSS(`
                .bbmc-panel { display:flex; flex-direction:column; height:100%; min-height:320px; font-size:12px; }
                .bbmc-header { display:flex; justify-content:space-between; align-items:center; padding:10px 10px 8px; border-bottom:1px solid var(--color-border); }
                .bbmc-title { font-size:14px; font-weight:700; }
                .bbmc-subtitle { opacity:.62; margin-top:2px; }
                .bbmc-status { opacity:.72; font-size:10px; display:flex; align-items:center; gap:5px; }
                .bbmc-status span { width:7px; height:7px; border-radius:50%; background:#54b86b; display:inline-block; }
                .bbmc-context { padding:8px 10px; background:var(--color-back); border-bottom:1px solid var(--color-border); line-height:1.45; }
                .bbmc-messages { flex:1; min-height:120px; overflow:auto; padding:9px; }
                .bbmc-message { margin-bottom:10px; }
                .bbmc-role { font-size:9px; letter-spacing:.08em; opacity:.52; margin:0 2px 3px; }
                .bbmc-bubble { border:1px solid var(--color-border); border-radius:7px; padding:8px; line-height:1.45; word-break:break-word; }
                .bbmc-user .bbmc-bubble { background:var(--color-accent); color:var(--color-accent_text); border-color:transparent; }
                .bbmc-quick-actions { display:flex; gap:5px; flex-wrap:wrap; padding:7px 9px; border-top:1px solid var(--color-border); }
                .bbmc-quick-actions button { flex:1; min-width:90px; }
                .bbmc-input-wrap { display:flex; gap:6px; padding:8px 9px 4px; }
                .bbmc-input-wrap textarea { flex:1; min-height:52px; max-height:130px; resize:vertical; border:1px solid var(--color-border); background:var(--color-back); color:var(--color-text); border-radius:6px; padding:7px; font:inherit; }
                .bbmc-send { width:38px; align-self:stretch; border-radius:6px; font-size:16px; }
                .bbmc-hint { padding:0 10px 8px; opacity:.45; font-size:10px; }
            `);

            panel = new Panel('blockbench_model_copilot_panel', {
                name: 'Model Copilot',
                icon: 'psychology',
                growable: true,
                resizable: true,
                default_position: {
                    slot: 'right_bar',
                    height: 420
                }
            });
            renderPanel();

            openAction = new Action('blockbench_model_copilot_open', {
                name: 'Model Copilot',
                description: 'Open the Blockbench Model Copilot panel',
                icon: 'psychology',
                click() {
                    if (panel) panel.selectTab();
                }
            });
            MenuBar.addAction(openAction, 'tools');

            selectionListener = () => renderPanel();
            Blockbench.on('update_selection', selectionListener);
        },

        onunload() {
            if (openAction) openAction.delete();
            if (panel) panel.delete();
            if (selectionListener) Blockbench.removeListener('update_selection', selectionListener);
            if (css) css.delete();
            panel = null;
            openAction = null;
            selectionListener = null;
            css = null;
        },

        oninstall() {
            Blockbench.showQuickMessage('Blockbench Model Copilot installed');
        }
    });
})();
