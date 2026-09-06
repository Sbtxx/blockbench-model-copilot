# 🧱 Blockbench Model Copilot

AI-assisted modeling directly inside [Blockbench](https://www.blockbench.net/).

Model Copilot is designed for people who have an idea for a Minecraft-style model but do not know how to build it efficiently. The plugin turns natural-language requests and reference images into a structured, reviewable model plan and then applies only safe, predefined operations to the current Blockbench project.

## ✨ What it does

- **Text → Model Plan** — describe a sword, creature, prop, weapon, character, or other blocky asset.
- **Reference Image → Model Plan** — attach a sketch or reference image and use a vision-capable AI provider to guide the design.
- **Plan → Blockbench** — create groups and cubes from the plan without executing arbitrary AI-generated JavaScript.
- **Conversational editing** — move, resize, rename, or remove existing elements through structured operations.
- **AI Model Review** — inspect the current project and get a score, strengths, issues, and suggestions.
- **Teach Me** — ask for a modeling workflow or an explanation of how to build a specific asset.
- **Offline fallback** — the plugin still provides deterministic starter models and basic guidance without an AI key.

## 🧠 Architecture

```text
User prompt / reference image
            ↓
      AI provider layer
            ↓
     Structured blueprint
            ↓
    Blueprint validation
            ↓
   Safe Blockbench operations
            ↓
       Editable model
```

The AI is never allowed to execute arbitrary code. Model changes are limited to a small operation set such as `create_group`, `create_cube`, `move`, `resize`, `rename`, and `delete`.

## 🤖 AI providers

The current implementation supports **OpenAI-compatible chat-completions endpoints**. In Blockbench open **Tools → Model Copilot Settings** and provide:

- Enable AI
- Endpoint URL
- Model name
- API key
- Request timeout
- Whether the model snapshot may be sent

The API key is stored in Blockbench local storage and is not committed to this repository.

Reference images require a provider/model that supports image input. The plugin sends the selected image as a data URL in the request.

## 🧪 Testing the plugin

Blockbench's plugin documentation supports testing a plugin by loading the JavaScript file from the plugin menu or dragging it into Blockbench.

For the current development build use:

```text
https://raw.githubusercontent.com/Sbtxx/blockbench-model-copilot/main/plugins/blockbench_model_copilot/blockbench_model_copilot.js
```

After changing the plugin, reload it from Blockbench's Plugins menu.

## 🛠️ Development

Requirements:

- Blockbench 5.x or newer
- Node.js 20+
- npm

Install development types:

```bash
npm install
```

Run repository validation:

```bash
npm run validate
```

The GitHub Actions workflow runs the validation script on pushes and pull requests.

## 🗺️ Roadmap

- [x] In-Blockbench Copilot panel
- [x] Safe blueprint operation layer
- [x] Text-driven starter model generation
- [x] AI provider integration
- [x] AI model review
- [x] Reference image input
- [x] Teaching mode
- [ ] Better proportion and symmetry reasoning
- [ ] Multi-view reference support (front / side / back)
- [ ] AI-assisted texture planning
- [ ] Better hierarchy and bone suggestions
- [ ] One-click safe fixes from review results
- [ ] Public plugin release preparation

## 📄 License

MIT License. See [LICENSE](LICENSE).
