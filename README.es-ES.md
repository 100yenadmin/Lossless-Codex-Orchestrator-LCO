# Lossless Codex Orchestrator

Dale a tu agente principal una capa de memoria y comandos para todos tus proyectos e hilos de Codex.

Codex es excelente realizando el trabajo. La parte difícil es gestionar todo ese trabajo una vez que tienes docenas o cientos de hilos distribuidos en repositorios, proyectos de clientes, correcciones, revisiones y seguimientos.

LCO convierte ese historial local de Codex disperso en una capa operativa que tu agente de OpenClaw, cliente de MCP, agente de orquestación estilo Hermes o agente personalizado puede utilizar. Tu agente puede encontrar el proyecto adecuado, entender qué sucedió, ver qué está bloqueado, preparar la siguiente acción y seguir avanzando sin tener que releer transcripciones enormes cada vez.

![Lossless Codex Orchestrator mostrando tarjetas de sesión, memoria de proyecto y herramientas de comando para agentes](https://raw.githubusercontent.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/main/assets/readme/hero.png)

[![npm latest](https://img.shields.io/npm/v/lossless-codex-orchestrator/latest?label=npm%20latest)](https://www.npmjs.com/package/lossless-codex-orchestrator)
[![npm beta](https://img.shields.io/npm/v/lossless-codex-orchestrator/beta?label=npm%20beta)](https://www.npmjs.com/package/lossless-codex-orchestrator)
[![CI](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/actions/workflows/ci.yml/badge.svg)](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/actions/workflows/ci.yml)
[![CodeQL](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/actions/workflows/codeql.yml/badge.svg)](https://github.com/100yenadmin/Lossless-Codex-Orchestrator-LCO/actions/workflows/codeql.yml)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

```bash
npm install -g lossless-codex-orchestrator@latest
lco doctor
lco find "billing bridge"
```

Si esto ayuda a tu agente principal a mantenerse al día con el trabajo de Codex, una estrella ayuda a otros creadores de agentes a encontrarlo. ⭐

[Configuración](docs/SETUP.md) · [Plugin de OpenClaw](docs/OPENCLAW_PLUGIN.md) · [Habilidad de Agente](skills/lossless-openclaw-orchestrator/SKILL.md) · [Visión](VISION.md) · [Privacidad](docs/PRIVACY.md) · [Límite de Hermes](docs/HERMES_ADAPTER_BOUNDARY.md) · [Contribución](CONTRIBUTING.md) · [AGENTS.md](AGENTS.md) · [Seguridad](SECURITY.md) · [Código de Conducta](CODE_OF_CONDUCT.md) · [Notas de Versión](docs/releases/CHANGELOG.md) · [Licencia](LICENSE)

## Por qué existe

Cuando usas Codex intensamente, el problema deja de ser "¿puede un agente programar?" y se convierte en "¿puede mi agente principal entender todo el trabajo que ya está en marcha?".

LCO le otorga a ese agente principal una memoria local y una superficie de comandos:

| Sin LCO | Con LCO |
| --- | --- |
| Los hilos están dispersos en muchas sesiones y proyectos. | Tu agente puede buscarlos y triajarlos desde un índice local único. |
| Cada traspaso comienza con un proceso de redescubrimiento. | Tarjetas preparadas muestran el objetivo, el bloqueo, el estado y la siguiente acción. |
| Las transcripciones largas consumen el contexto. | Las hojas de resumen y la expansión acotada permiten a los agentes leer el fragmento correcto. |
| OpenClaw u otro orquestador tiene que adivinar qué hizo Codex. | Las herramientas MCP/OpenClaw exponen el estado de Codex directamente al orquestador. |
| "Continuar este trabajo" es arriesgado porque el objetivo puede no estar claro. | Los paquetes de comandos de prueba (dry-run) muestran el hilo y la acción exacta antes de ejecutar nada. |

El objetivo es sencillo: tu agente de orquestación debe gestionar el trabajo de Codex de la misma manera que lo haría un buen operador técnico. Debe conocer los proyectos, los hilos activos, el trabajo obsoleto, el trabajo bloqueado, el trabajo finalizado y el siguiente movimiento correcto.

## Qué hace ✨

LCO es más que un índice de transcripciones. Construye una imagen operativa legible para agentes sobre el trabajo local de Codex.

**Memoria de proyectos e hilos**

- Indexa las sesiones locales de Codex en una base de datos SQLite local.
- Utiliza búsqueda FTS5 ponderada por campos para el descubrimiento de tarjetas de sesión a través de títulos, resúmenes, planes propuestos, mensajes finales, archivos tocados, metadatos de herramientas y texto seguro preparado. Para frases de contenido recordadas, usa `lco grep` o `lco expand-query`.
- Combina relevancia, recencia, coincidencia de identificadores y respaldo de consultas para que los agentes puedan encontrar "el plan del billing bridge" o "el PR que tocó la autenticación" sin el ID exacto del hilo.
- Detecta desviaciones en el formato JSONL de Codex en `lco doctor` para que las importaciones rotas sean visibles en lugar de que el trabajo falte silenciosamente.

**Estado preparado para agentes**

- Crea tarjetas preparadas para los hilos de Codex: objetivo, bloqueo, estado del ciclo de vida, siguiente acción, frescura, confianza y referencias de origen.
- Construye una bandeja de entrada preparada para que tu agente principal pueda comenzar con "¿qué necesita mi atención?" en lugar de una búsqueda bruta.
- Rastrea estados del ciclo de vida como: completado, esperando aprobación, observando una verificación externa, necesita reanudación, traspaso de árbol de trabajo sucio, listo para revisión, obsoleto/parcial y desconocido.
- Mantiene visible el trabajo completado, para que los carriles finalizados aún puedan ser encontrados y citados.

**Hojas de resumen y expansión acotada**

- Divide sesiones grandes en rangos de origen y hojas de resumen deterministas.
- Crea referencias de hoja para prompts de usuario, planes, mensajes finales, cierres, archivos tocados, metadatos de herramientas y marcadores de compactación.
- Permite que un agente expanda un resumen breve de 1k tokens o un paquete de evidencia más profundo de 4k tokens en lugar de cargar una transcripción completa.
- Informa sobre omisiones cuando un resumen es intencionalmente más pequeño que la sesión subyacente.

**Herramientas de imagen operativa**

- `lco_recent_sessions` muestra el trabajo de Codex reciente o activo como tarjetas compactas.
- `lco_attention_inbox` enumera los hilos que necesitan acción, revisión, aprobación, observación o triaje de bloqueos.
- `lco_project_digest` crea un resumen de traspaso a nivel de proyecto a partir de tarjetas de Codex, elementos opcionales de GitHub, fijaciones de planes y cobertura de fuentes.
- `lco_operating_picture` impulsa vistas estilo cabina (cockpit) como mapas de sesión, siguientes pasos de colaboración, estado de hilos activos, planificación de ticks de autonomía, elementos operativos de GitHub y tarjetas de pulso de negocio.

**Capa de comandos para orquestadores**

- Expone el mismo registro local a través de comandos CLI, un servidor MCP y un plugin de OpenClaw.
- Ofrece a los agentes normales una fachada compacta: bandeja de entrada preparada, sesiones recientes, resumen de proyecto, bandeja de atención, expansión acotada, descripción y prueba seca (dry run) de control de Codex.
- Crea paquetes de comandos de prueba seca para acciones de inicio/reanudación/envío/dirección/interrupción de Codex, para que el objetivo y la acción puedan ser revisados antes de la ejecución real.
- Para acciones reales de Codex, el paquete puede incluir el objetivo exacto, la acción, el hash del mensaje y el ID de aprobación que tu agente principal debe mostrar antes de proceder.
- Fija la ruta de control en vivo de Codex soportada actualmente a `approvalPolicy=never` y un sandbox de solo lectura sin red; LCO no hereda ni amplía los permisos de tiempo de ejecución ambientales de un hilo. La dirección y la interrupción de turnos activos fallan por seguridad a menos que la respuesta de reanudación de la misma conexión demuestre que dicha postura ya está en efecto.
- Añade comandos de sidecar para la captura de cierre, preparación de estado, captura de marcadores de compactación y alias de títulos de hilos.

## Para quién es

Usa LCO si:

- ejecutas Codex en muchos repositorios, proyectos de clientes o líneas de producto
- usas OpenClaw como tu agente/operador local principal
- quieres que un orquestador estilo Hermes o personalizado gestione el trabajo de Codex a través de MCP
- necesitas que los agentes traspasen el trabajo sin releer transcripciones masivas
- quieres un lugar único para preguntar "¿qué está activo, bloqueado, obsoleto, terminado o listo?"
- quieres resúmenes de proyecto y breves de siguiente acción que tus agentes realmente puedan usar

Si solo ejecutas una sesión corta de Codex a la vez, LCO puede ser más sistema de lo que necesitas. Si Codex se está convirtiendo en tu fuerza laboral de ingeniería diaria, esta es la capa de memoria que ayuda a un agente principal a gestionarlo.

## Instalación 🚀

Requisitos:

- Node.js 22.5 o posterior
- npm
- archivos de sesión locales de Codex, usualmente en `~/.codex/sessions`
- OpenClaw Desktop/CLI si quieres que OpenClaw llame a las herramientas `lco_*` instaladas

Instalación estable:

```bash
npm install -g lossless-codex-orchestrator@latest
lco doctor
```

`lossless-codex-orchestrator` es el nombre actual del paquete npm publicado. El paquete de compatibilidad obsoleto `lossless-openclaw-orchestrator` se mantiene para la automatización existente y apunta al mismo CLI `lco` y al mismo `lco-mcp-server`. Los nombres históricos `loo`, `loo-mcp-server` y las variables de entorno `LOO_*` se mantienen como alias de compatibilidad durante al menos dos versiones menores.

```bash
loo index codex "$HOME/.codex/sessions"
loo-mcp-server
```

Rama beta, cuando explícitamente quieras la versión preliminar más reciente:

```bash
npm install -g lossless-codex-orchestrator@beta
```

Canales de paquetes:

- Estable actual: `1.6.0` distribuido en `latest` como la versión Control Plane para cursores de diferencia de sesión acotados, pruebas secas de "revisar-y-conducir" con presupuestos y vinculación de auditoría, verificación de control de hilos provisionales de Codex, tarjetas preparadas LCM y diagnósticos entre pares, y un carril de validación de adaptador de Claude que permanece solo en modo de prueba seca.
- `latest` es el canal público estable.
- `beta` es la rama activa de versiones preliminares.
- `next` está reservado para candidatos a lanzamiento (RC).

Si npm muestra una versión o etiqueta de distribución pero la instalación falla con un error de corte de selector como `ENOVERSIONS` o `ETARGET`, usa el respaldo de tarball de desviación de selector de npm con comandos raw que una shell fresca pueda ejecutar:

```bash
tarball_url="$(npm view lossless-codex-orchestrator@latest dist.tarball)"
test -n "$tarball_url" && npm install -g "$tarball_url"
```

Si el mensaje `ETARGET` dice que la versión del paquete solicitada debe tener una fecha de publicación anterior a una hora específica, verifica si hay un anclaje local de npm `min-release-age` o `before` antes de tratarlo como una desviación del registro.

Las instrucciones completas de configuración están en [docs/SETUP.md](docs/SETUP.md).

## Configuración

Elige dónde almacena LCO su índice local. El valor predeterminado ya está en `~/.openclaw`, pero configurarlo explícitamente facilita la inspección de la configuración:

```bash
export LCO_DB_PATH="$HOME/.openclaw/lossless-openclaw-orchestrator/orchestrator.sqlite"
```

Indexa las sesiones locales de Codex:

```bash
lco index codex --max-files 500 "$HOME/.codex/sessions" "$HOME/.codex/archived_sessions"
```

El importador aplica un límite de índice por archivo de 256 MB / 200,000 eventos, para que un archivo JSONL excesivamente grande no domine la primera ejecución. Si `lco index codex` reporta `codex_index_limited_files_skipped`, usa `--max-bytes-per-file <bytes>` y `--max-events-per-file <events>` solo cuando intencionalmente quieras ampliar esa ventana de indexación local.

El caché de contenido por evento es data derivada local utilizada para una recuperación más profunda. Si necesitas pausar ese caché o recuperar espacio, usa:

```bash
export LCO_EVENT_CONTENT=disabled
lco maintenance --drop-event-content
```

Rehabilítalo eliminando `LCO_EVENT_CONTENT` y ejecutando `lco index codex` nuevamente.

Opcional: permite la recuperación desde una o más bases de datos pares de OpenClaw LCM:

```bash
export LCO_LCM_DB_PATHS="$HOME/.openclaw/lcm.db"
```

Los pares configurados permanecen en modo de solo lectura. `lco index codex` y `lco find` materializan tarjetas asesoras seguras para el público y elementos de bandeja de entrada a partir de sus DAG de resumen sin copiar las filas del par en las tablas fuente de LCO. Inspecciona la preparación e integridad de los pares con `lco doctor --peers`; los pares se clasifican como listos, degradados o no disponibles, con razones de omisión por tablas faltantes, resúmenes vacíos y enlaces DAG obsoletos.

Verifica la preparación local:

```bash
lco doctor --peers
lco onboard status --strict
```

## Primer Flujo de Trabajo 🧭

Encuentra el trabajo que recuerdas. `lco find` ejecuta una pasada de índice incremental local el primer uso, luego busca en títulos, metadatos, tarjetas preparadas, resúmenes y fragmentos de contenido a nivel de evento:

```bash
lco find "billing bridge proposed plan"
```

Usa JSON cuando quieras la misma forma de resultado en scripts o arneses de agentes:

```bash
lco find --json "billing bridge proposed plan"
```

Para una recuperación de nivel más bajo, usa `lco search` para el descubrimiento de títulos/tarjetas de sesión y `lco grep` o `lco expand-query` para la recuperación orientada al contenido.

Antes de preparar un plan de ejecución, pregunta qué ha cambiado desde un cursor seguro para el público:

```bash
lco session-diff --cursor <cursor>
```

Construye un paquete de "revisar-y-conducir" acotado sin ejecutar el control en vivo:

```bash
lco drive --dry-run --reviewer codex --driver claude --max-turns 3
```

Cuando los pares LCM están configurados, inspecciona su postura de integridad de solo lectura con `lco doctor --peers`. El direccionamiento de Claude en la versión 1.6 valida únicamente la disponibilidad y la política de prueba seca; no proporciona control en vivo de Claude.

Describe un resultado:

```bash
lco describe codex_thread:<thread-id>
```

Expande un resumen breve:

```bash
lco expand-ref --profile brief --token-budget 1000 codex_thread:<thread-id>
```

Expande desde una consulta cuando aún no conoces la referencia:

```bash
lco expand-query --profile brief --token-budget 1000 "billing bridge"
```

Para un agente o cliente MCP, comienza con la ruta de operador normal:

| Paso | Herramienta | Qué obtiene tu agente |
| --- | --- | --- |
| 1 | `lco_find` | Indexación local de primera ejecución más coincidencias de sesión/contenido seguras desde una consulta. |
| 2 | `lco_prepared_inbox` | La mejor vista inicial del trabajo que necesita atención. |
| 3 | `lco_describe_ref` | Detalles de un hilo, tarjeta, hoja o referencia de fuente seleccionada. |
| 4 | `lco_expand_query` | Un resumen acotado cuando la referencia exacta es desconocida. |
| 5 | `lco_recent_sessions` | Trabajo de Codex reciente y activo como tarjetas compactas. |
| 6 | `lco_attention_inbox` | Trabajo bloqueado, en espera, obsoleto, que necesita aprobación o que está listo para revisión. |
| 7 | `lco_project_digest` | Un resumen de traspaso a nivel de proyecto. |
| 8 | `lco_codex_control_dry_run` | Un paquete de vista previa para la acción exacta de Codex. |
| 9 | `lco_codex_resume_thread` | Reanuda un hilo de Codex después de que el paquete de prueba seca sea aprobado. |

El libro de jugadas (playbook) empaquetado para agentes está en [skills/lossless-openclaw-orchestrator/SKILL.md](skills/lossless-openclaw-orchestrator/SKILL.md).

Nota sobre nombres: `LCO` es la abreviatura pública del producto. Los nuevos ejemplos orientados al usuario usan `lco`, `lco-mcp-server` y las herramientas canónicas `lco_*`. Los nombres históricos `loo`, `loo-mcp-server` y `loo_*` se mantienen como alias de compatibilidad durante al menos dos versiones menores.

## Compatibilidad 🔌

| Superficie | Estado | Qué usar hoy |
| --- | --- | --- |
| Sesiones locales de Codex | Estable | `lco index codex`, `lco search`, `lco describe` y expansión acotada. |
| Clientes MCP | Estable | `lco-mcp-server` expone el registro de herramientas local a través de stdio. |
| OpenClaw | Estable | Instala el plugin y deja que tu agente de OpenClaw llame a las herramientas `lco_*`. |
| Agentes estilo Hermes y personalizados | Soportado por MCP, adaptador nativo pospuesto | Usa la superficie de MCP hoy; consulta [docs/HERMES_ADAPTER_BOUNDARY.md](docs/HERMES_ADAPTER_BOUNDARY.md). |

LCO prioriza OpenClaw porque es donde se ha probado intensamente el producto, pero la capa útil es más amplia: una memoria y superficie de comandos local de Codex que cualquier arnés de agente puede llamar a través de CLI o MCP.

Los usuarios de Claude Code que ya ejecutan `codex-plugin-cc` pueden añadir LCO como un compañero de recuperación independiente:

```text
/plugin marketplace add 100yenadmin/Lossless-Codex-Orchestrator-LCO
/plugin install lco-recall@lco
```

El compañero proporciona una habilidad `find` invocable por el usuario para la recuperación local y deja la propiedad de los comandos de Codex en manos de `codex-plugin-cc`.

## OpenClaw y MCP

Ejecuta el servidor MCP directamente:

```bash
lco-mcp-server
```

Entrada típica de cliente MCP:

```json
{
  "mcpServers": {
    "lco": {
      "command": "lco-mcp-server"
    }
  }
}
```

Instala el plugin de OpenClaw desde npm:

```bash
openclaw plugins install lossless-codex-orchestrator@latest
openclaw plugins list --json
```

Prueba la ruta de OpenClaw:

```bash
lco openclaw dogfood --profile lco-dogfood --install-source lossless-codex-orchestrator@latest --required-tool lco_doctor --required-tool lco_search_sessions --strict
lco openclaw tool-smoke --profile lco-dogfood --required-tool lco_doctor --required-tool lco_search_sessions --strict
```

La exposición de herramientas puede limitarse con `LCO_TOOL_PROFILE=facade|standard|all`. El valor predeterminado es `all`, preservando el catálogo completo. `facade` expone la ruta compacta del operador (`lco_*`) más los alias de compatibilidad `loo_*`; `standard` añade herramientas de detalle de flujo de trabajo. El filtrado de perfiles afecta solo al listado de herramientas y a las declaraciones de OpenClaw.

Consulta [docs/OPENCLAW_PLUGIN.md](docs/OPENCLAW_PLUGIN.md) para la ruta completa de configuración de OpenClaw.

## Privacidad y Datos Locales

LCO lee archivos de sesión locales de Codex y escribe un índice SQLite local. Está construido para que los agentes puedan trabajar con referencias de fuente, tarjetas, resúmenes y breves acotados en lugar de abrir archivos de transcripción raw enormes por defecto.

Para más detalles, lee [docs/PRIVACY.md](docs/PRIVACY.md) y [docs/SAFE_SUMMARIES.md](docs/SAFE_SUMMARIES.md).

## Comunidad y Contribución

LCO está diseñado para ser fácil de probar y sencillo de mejorar. La ruta de contribución pública es:

1. Lee [CONTRIBUTING.md](CONTRIBUTING.md) para el enrutamiento de problemas, validación, evidencia y expectativas de PRs creados por agentes.
2. Sigue [docs/SETUP.md](docs/SETUP.md) para la instalación local y configuración de primera ejecución.
3. Usa [AGENTS.md](AGENTS.md) cuando un agente de codificación esté realizando o revisando el cambio.
4. Reporta un error, error de documentación, solicitud de funcionalidad, solicitud de adaptador, reporte de desviación de protocolo o reporte de control de comandos a través de los formularios de incidencias de GitHub.

Los buenos candidatos para primeras incidencias son brechas en la documentación, cobertura de fixtures redactados, diagnósticos de configuración, mejoras en plantillas de incidencias y correcciones estrechas de ayuda de la CLI. Usa el formulario de solicitud de adaptador para pedir uno; describe la aplicación/runtime de destino, la ruta de lectura/indexación, la ruta de comandos y la evidencia sanitizada disponible para probarlo.

Nunca pegues transcripciones raw de Codex, bases de datos SQLite privadas, tokens, cookies, URLs de conectores o datos de clientes en incidencias públicas o PRs. Usa [SECURITY.md](SECURITY.md) para reportes privados de vulnerabilidades y [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) para las expectativas de la comunidad.

## Arquitectura

- `packages/core`: índice SQLite local, búsqueda ponderada por campos, referencias de fuente, hojas de resumen, tarjetas preparadas, bandejas de entrada, descripciones de sesión y expansión acotada.
- `packages/mcp-server`: servidor MCP stdio que expone las herramientas de operador `lco_*` y los alias de compatibilidad `loo_*`.
- `packages/openclaw-plugin`: entrada del plugin de OpenClaw y superficie de manifiesto.
- `.codex-plugin/` y `hooks/`: manifiesto del plugin de Codex, configuración de Stop hook y envoltorio para alias de títulos de hilos locales.
- `packages/cli`: CLI `lco` para configuración, indexación, recuperación, smoke tests, evaluación y verificaciones de lanzamiento, con `loo` mantenido como alias de compatibilidad.
- `packages/adapters`: transporte de Codex, auditoría, redacción, preparación para escritorio y contratos de adaptador.
- `skills/`: libro de jugadas de OpenClaw empaquetado orientado al agente.
- `evals/`: contratos de escenarios y tarjetas de puntuación.
- `docs/`: configuración, privacidad, autoridad de fuente, documentación de adaptadores y guías del mantenedor.

## Hoja de Ruta

Estable hoy: indexación local de Codex, búsqueda ponderada por campos, tarjetas preparadas, bandejas de entrada preparadas, hojas de resumen, expansión acotada, resúmenes de proyecto, herramientas de OpenClaw/MCP y la capa de comandos de prueba seca.

Desde la versión 1.2.x, la línea de estado preparado y hojas de resumen de la 1.2 se ha distribuido como parte de la línea de productos estables. Ese trabajo añadió rangos respaldados por referencias de fuente, hojas de resumen deterministas, tarjetas preparadas, elementos de bandeja de entrada preparados, observaciones de observadores, elementos de cola de atención y captura de hooks para que un agente de OpenClaw o un agente de orquestación principal pueda comenzar desde un estado preparado compacto en lugar de releer transcripciones enormes de Codex. El traspaso de arquitectura histórico permanece en [docs/sprints/brief-lco-1.2-prepared-state-summary-leaves-2026-07-03.md](docs/sprints/brief-lco-1.2-prepared-state-summary-leaves-2026-07-03.md).

El trabajo de identidad de la 1.4 convierte a `lco`, `lco-mcp-server`, `lco_*` y `LCO_*` en los nombres canónicos de comandos y herramientas, con `loo`, `loo-mcp-server`, `loo_*` y `LOO_*` mantenidos como alias de compatibilidad durante al menos dos versiones menores. El paquete npm actual es `lossless-codex-orchestrator`; el paquete de compatibilidad obsoleto `lossless-openclaw-orchestrator` se mantiene para la automatización existente.

Para la dirección completa del producto, lee [VISION.md](VISION.md).

## Desarrollo

```bash
npm install
npm run build
npm test
npm run check
```

El conjunto de pruebas utiliza fixtures redactados y el ejecutor de pruebas integrado de Node. Se espera que la validación pesada se ejecute en CI; el desarrollo local debe usar pruebas enfocadas primero.

Para detalles del flujo de trabajo del contribuidor, usa [CONTRIBUTING.md](CONTRIBUTING.md).

## Licencia

La fuente actual y las versiones publicadas en npm están disponibles bajo la [PolyForm Noncommercial License 1.0.0](LICENSE). Se permite el uso no comercial bajo esos términos.

**Usar LCO tú mismo — incluso en el trabajo — está bien y se anima a hacerlo.** Integrar LCO dentro de un producto o servicio que vendas requiere una licencia comercial (términos estándar: 5% del precio del producto integrado, o negociado). Guía en lenguaje sencillo: [docs/COMMERCIAL_LICENSING.md](docs/COMMERCIAL_LICENSING.md) — o simplemente envía un correo a **support@electricsheephq.com**.
