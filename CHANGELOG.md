# Changelog

All notable changes to this project will be documented here.

## [0.2.1] - 2026-09-06

### Changed

- Rebranded the in-Blockbench assistant from **Model Copilot** to **Mikonode**.
- Localized the main plugin interface and messages to Spanish.
- Updated menu actions, panel labels, quick actions, settings text, and fallback guidance.
- Updated repository metadata and validation checks for the new product name and version.

## [0.2.0] - 2026-09-06

### Added

- AI provider layer using OpenAI-compatible chat-completions APIs.
- Structured AI model blueprints instead of arbitrary generated code.
- Blueprint validation and operation limits before modifying Blockbench.
- Text-to-model planning with an explicit apply step.
- Reference image attachment for vision-capable AI providers.
- AI-assisted model review with score, strengths, issues, and suggestions.
- AI-assisted teaching mode.
- Configurable endpoint, model, timeout, and model-snapshot privacy setting.
- Offline deterministic fallback when no AI provider is configured.
- Updated plugin metadata for Blockbench 5.x.

## [0.1.0] - 2026-09-05

### Added

- Initial Model Copilot panel inside Blockbench.
- Natural-language starter model generation for several common model types.
- Project/model health analyzer.
- Beginner-oriented modeling guidance.
- Basic natural-language edits for selected cubes.
- Undo-safe model modifications.
- GitHub Actions validation workflow.
- Local metadata validation script.
