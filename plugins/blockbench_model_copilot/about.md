# Blockbench Model Copilot

Blockbench Model Copilot is an external Blockbench plugin designed to help beginners build better 3D models without leaving Blockbench.

## What it does today

- Opens a dedicated **Model Copilot** panel inside Blockbench.
- Creates simple starter models from natural-language prompts.
- Analyzes the current project and produces a model-health report.
- Applies a small set of natural-language edits to selected cubes.
- Provides modeling guidance through a beginner-friendly **Teach Me** flow.
- Keeps model edits undoable through Blockbench's Undo API.

## Current scope

Version 0.1 is intentionally offline. The interface and model-operation layer are being built first so future AI providers can be added without giving a remote model uncontrolled access to the Blockbench environment.

## Planned direction

- AI provider abstraction
- Context-aware model inspection
- Image/reference understanding
- Guided modeling lessons
- More precise model operations
- Model critique and proportions feedback
- Provider settings and privacy controls

## Development

The plugin lives at `plugins/blockbench_model_copilot/blockbench_model_copilot.js`.

For local testing, load the plugin file through Blockbench's plugin development workflow. The official Blockbench documentation explains local plugin testing and the plugin directory conventions.
