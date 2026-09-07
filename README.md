# 🧱 Mikonode

Asistente de modelado con IA dentro de [Blockbench](https://www.blockbench.net/).

**Mikonode** ayuda a convertir una idea, texto o referencia visual en un plan de geometría editable y revisable dentro de Blockbench. La IA propone operaciones estructuradas y Mikonode valida esas operaciones antes de tocar el proyecto.

> **Estado:** desarrollo activo · versión `0.3.2`

## ✨ Qué hace

- **Texto → modelo:** describe una espada, criatura, arma, personaje u otro asset y genera un plan de cubos/grupos.
- **Referencia → modelo:** adjunta hasta 3 imágenes PNG/JPG/WebP; Mikonode las reduce localmente antes de enviarlas al proveedor de IA y usa la información visual para proponer la geometría.
- **Plan revisable:** muestra un resumen y las operaciones antes de aplicar cambios.
- **Plan → Blockbench:** crea grupos y cubos editables sin ejecutar JavaScript generado por la IA.
- **Edición conversacional:** permite mover, escalar, rotar, renombrar o eliminar elementos mediante operaciones controladas.
- **Contexto del proyecto:** puede enviar a la IA un snapshot limitado del modelo actual, incluidos UUID, nombres, dimensiones, origen y rotación.
- **Revisión del modelo:** analiza proporciones, silueta, simetría, jerarquía y preparación para textura/animación.
- **Aprender a modelar:** responde con pasos prácticos para construir un asset.
- **Modo local:** mantiene generadores y revisión básica aun sin API configurada.

## 🧠 Arquitectura segura

```text
Texto / referencias / contexto del modelo
                    ↓
              Proveedor de IA
                    ↓
           JSON estructurado
                    ↓
              Validación
                    ↓
       Operaciones permitidas
                    ↓
             Blockbench API
                    ↓
            Modelo 3D editable
```

La IA **no puede ejecutar código arbitrario**. Mikonode acepta únicamente estas operaciones:

`crear_grupo`, `crear_cubo`, `mover`, `escalar`, `rotar`, `renombrar`, `eliminar`.

Los cambios se realizan dentro del sistema Undo de Blockbench.

## 🤖 Proveedores y API

Mikonode no incluye una API key compartida. Cada usuario proporciona sus propias credenciales y paga su propio consumo del proveedor.

La versión `0.3.x` admite dos formatos:

- **OpenAI Responses:** endpoint por defecto `https://api.openai.com/v1/responses`.
- **OpenAI Chat Completions / compatible:** útil para otros proveedores que mantengan ese formato.

La configuración se encuentra en **Herramientas → Configuración de Mikonode**. Puedes establecer proveedor, endpoint, modelo, API key, tiempo límite y qué contexto se envía.

La API key se guarda localmente en el almacenamiento de Blockbench y **no debe incluirse en GitHub, README, capturas públicas ni archivos del proyecto**.

> La API de OpenAI y una suscripción de ChatGPT son servicios separados. El saldo, límites y facturación de la API pertenecen a la cuenta de API del usuario.

## 🖼️ Flujo de referencias visuales

1. Pulsa **Agregar referencia**.
2. Selecciona una o varias imágenes.
3. Escribe qué quieres obtener, por ejemplo: `Convierte esta referencia en un personaje Minecraft low-poly; conserva la silueta y las proporciones principales.`
4. Mikonode prepara las imágenes y construye el contexto del proyecto.
5. El proveedor de IA devuelve el plan estructurado.
6. Mikonode valida el plan y permite **Aplicar plan**.

Las imágenes se reducen en el equipo antes de la petición para evitar enviar archivos innecesariamente grandes.

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

La validación comprueba metadata, sintaxis, coherencia de versión y algunas reglas de seguridad básicas. GitHub Actions la ejecuta automáticamente en pushes y pull requests.

## 🧪 Probar el plugin

Puedes cargar el JavaScript desde el menú de plugins de Blockbench o usar esta URL de desarrollo:

```text
https://raw.githubusercontent.com/Sbtxx/blockbench-model-copilot/main/plugins/blockbench_model_copilot/blockbench_model_copilot.js
```

Después de actualizar el plugin en GitHub, recarga el plugin en Blockbench.

## 🗺️ Roadmap

- [x] Panel de Mikonode dentro de Blockbench
- [x] Operaciones seguras mediante planes estructurados
- [x] Generación básica desde texto
- [x] Integración con proveedor de IA
- [x] Revisión de modelos
- [x] Referencias de imagen
- [x] Soporte de hasta 3 referencias en una petición
- [x] Contexto del modelo actual
- [x] Modo de aprendizaje
- [x] Interfaz principal en español
- [x] Prueba de conexión del proveedor
- [ ] Diagnóstico detallado de errores de red y firewall
- [ ] Proporciones y simetría avanzadas
- [ ] Referencias multi-vista especializadas
- [ ] Asistencia de texturas y UV
- [ ] Jerarquía/huesos sugeridos por IA
- [ ] Correcciones seguras de un clic con diff antes/después
- [ ] Integración opcional con modelos locales (Ollama / LM Studio)
- [ ] Preparación para publicación pública como plugin de Blockbench

## 📄 Licencia

MIT License. Consulta [LICENSE](LICENSE).
