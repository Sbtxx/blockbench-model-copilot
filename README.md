# 🧱 Blockbench Model Copilot

> An AI-ready assistant inside Blockbench for people who have an idea for a model but don't know where to start.

Blockbench Model Copilot brings a beginner-friendly assistant directly into Blockbench. The long-term goal is to help users **describe, build, edit, understand, and improve 3D models without leaving the editor**.

## ✨ Vision

```text
Describe an idea
      ↓
Model Copilot
      ↓
Plan → Create → Edit → Review → Learn
      ↓
Blockbench model
```

The project is built as an external Blockbench plugin. Blockbench supports JavaScript plugins, sidebar panels, model manipulation, and undoable edits.

## 🚀 v0.1 — Offline MVP

The first version is deliberately useful without requiring an API key:

- **Model Copilot panel** inside Blockbench
- **Starter model generation** from simple natural-language prompts
- **Model Analyzer** with project statistics, issues, and suggestions
- **Natural-language selection edits** such as making selected cubes larger or moving them
- **Teach Me** guidance for beginner modeling workflows
- **Undo-safe edits** using Blockbench's Undo system
- **Clean plugin lifecycle** with proper unload cleanup

This version is the foundation for the AI layer rather than pretending to be a full generative 3D modeler.

## 🧠 Planned AI capabilities

- Context-aware model understanding
- Natural-language model editing
- Image/reference assisted modeling
- Model critique and proportion feedback
- Guided modeling lessons
- AI provider abstraction with user-controlled settings
- Safer structured model operations instead of executing arbitrary generated code

## 🛠️ Project structure

```text
blockbench-model-copilot/
├── plugins/
│   └── blockbench_model_copilot/
│       ├── blockbench_model_copilot.js
│       └── about.md
├── scripts/
│   └── validate.mjs
├── .github/
│   └── workflows/
│       └── validate.yml
├── package.json
├── CHANGELOG.md
├── LICENSE
└── README.md
```

## 🧪 Local testing

1. Open the project in your editor.
2. Install the development dependency with `npm install`.
3. Run `npm run validate`.
4. Load `plugins/blockbench_model_copilot/blockbench_model_copilot.js` into Blockbench using its plugin development workflow.

For more information, see:
- Blockbench plugin development: https://blockbench.net/wiki/docs/plugin/
- Blockbench reference documentation: https://web.blockbench.net/docs/
- Blockbench plugins repository: https://github.com/JannisX11/blockbench-plugins

## 📌 AI and the official plugin store

This repository is maintained independently. The official Blockbench plugin repository currently states that plugins using generative AI are not accepted there. That makes this repository a good place to develop and test the concept without coupling the project to the official store's current policy.

## 📄 License

MIT
