# Changelog

All notable changes to this project will be documented here.

## [0.3.0] - 2026-09-06

### Added

- OpenAI Responses API integration as the default AI transport.
- Compatibility mode for OpenAI-style Chat Completions endpoints.
- Current default model set to `gpt-5.6-luna`, while keeping the model editable in settings.
- Correct multimodal reference-image input instead of embedding image data inside a JSON string.
- Up to 3 image references per request.
- Client-side image resizing and JPEG conversion before upload.
- Better model and selection context sent to the AI, including UUIDs for safer edits.
- New safe `rotar` operation.
- Structured plan preview in the Mikonode panel before applying changes.
- Connection test from the AI settings dialog.
- Dedicated AI configuration dialog with provider, endpoint, model, key, timeout, privacy, and image settings.
- Clear reference management UI.

### Changed

- Replaced the previous single-image `imagen_base64` JSON field with provider-native multimodal input.
- Increased the planning quality prompt to explicitly reason about silhouette, proportions, symmetry, hierarchy, and visual references.
- Improved Blockbench canvas refresh after applying plans.
- Updated local fallback and project context handling.
- Bumped package/plugin version to `0.3.0`.

### Security

- AI output remains constrained to a fixed allowlist of modeling operations.
- Mikonode never executes arbitrary JavaScript returned by the model.
- API keys remain local to the Blockbench installation and are not committed to the repository by the plugin.

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
