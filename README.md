# 🧱 Mikonode

Asistente de modelado con IA dentro de [Blockbench](https://www.blockbench.net/).

**Mikonode** está pensado para personas que tienen una idea para un modelo estilo Minecraft pero no saben cómo construirla eficientemente. El plugin convierte instrucciones en lenguaje natural y referencias visuales en un plan de modelo revisable y después aplica operaciones seguras y predefinidas al proyecto actual de Blockbench.

> **Estado:** desarrollo activo · versión `0.2.1`

## ✨ Qué hace

- **Texto → plan de modelo:** describe una espada, criatura, objeto, arma, personaje u otro asset de estilo bloqueado.
- **Boceto/referencia → plan:** carga una imagen para que un proveedor de IA con visión ayude a interpretar el diseño.
- **Plan → Blockbench:** crea grupos y cubos sin ejecutar JavaScript arbitrario generado por la IA.
- **Edición conversacional:** mover, escalar, renombrar o eliminar elementos mediante operaciones controladas.
- **Revisión del modelo:** analiza el proyecto y devuelve puntuación, fortalezas, problemas y sugerencias.
- **Aprender a modelar:** explica procesos de modelado paso a paso.
- **Modo local:** el plugin sigue funcionando con funciones básicas aunque no haya una API de IA configurada.
- **Interfaz en español:** la experiencia principal del plugin está localizada al español.

## 🧠 Arquitectura

```text
Texto / boceto
      ↓
Proveedor de IA
      ↓
Plan estructurado
      ↓
Validación
      ↓
Operaciones seguras de Blockbench
      ↓
Modelo 3D editable
```

La IA no puede ejecutar código arbitrario. Los cambios están limitados a operaciones como `crear_grupo`, `crear_cubo`, `mover`, `escalar`, `renombrar` y `eliminar`.

## 🤖 Configuración de IA

La implementación admite endpoints compatibles con **OpenAI Chat Completions**. Dentro de Blockbench abre **Herramientas → Configuración de Mikonode** y configura:

- Activar IA
- URL del endpoint
- Nombre del modelo
- API key
- Tiempo límite
- Envío opcional del resumen del modelo

La API key se almacena en el almacenamiento local de Blockbench y no se incluye en este repositorio.

Las referencias de imagen requieren un proveedor/modelo que acepte entradas de imagen.

## 🧪 Probar el plugin

La documentación de Blockbench permite probar plugins cargando el archivo JavaScript desde el menú de plugins o usando una URL de desarrollo.

URL actual del plugin:

```text
https://raw.githubusercontent.com/Sbtxx/blockbench-model-copilot/main/plugins/blockbench_model_copilot/blockbench_model_copilot.js
```

Después de actualizar el plugin en GitHub, pulsa **Recargar** en la pantalla de Plugins de Blockbench.

## 🛠️ Desarrollo

Requisitos:

- Blockbench 5.x o superior
- Node.js 20+
- npm

Instalar dependencias:

```bash
npm install
```

Validar el repositorio:

```bash
npm run validate
```

GitHub Actions ejecuta la validación automáticamente en pushes y pull requests.

## 🗺️ Roadmap

- [x] Panel de Mikonode dentro de Blockbench
- [x] Operaciones seguras mediante planes estructurados
- [x] Generación básica desde texto
- [x] Integración con proveedor de IA
- [x] Revisión de modelos
- [x] Entrada de imágenes de referencia
- [x] Modo de aprendizaje
- [x] Interfaz principal en español
- [ ] Mejor razonamiento de proporciones y simetría
- [ ] Referencias multi-vista (frontal / lateral / trasera)
- [ ] Asistencia de texturas
- [ ] Sugerencias de jerarquía y huesos
- [ ] Correcciones seguras de un clic
- [ ] Preparación para publicación pública como plugin

## 📄 Licencia

MIT License. Consulta [LICENSE](LICENSE).
