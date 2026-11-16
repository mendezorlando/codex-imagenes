# codex-imagenes

Genera imágenes con **tu suscripción de ChatGPT**, a través de Codex CLI y su herramienta integrada `image_gen`. Nunca usa la API ni una clave.

## Qué hace
Registra la herramienta `generar` (`mcp__codex-imagenes__generar`). Claude la llama con:
- **`encargo`:** lo que debe mostrar la imagen;
- **`destino`:** un `.png`;
- **`referencias`** (opcional): hasta 8 imágenes, para mantener un personaje, un producto o un estilo;
- **`tamano`** (opcional): `1536x1024`, `1024x1536` o `1024x1024`;
- **`sobrescribir`** (opcional).

**Cómo llama a Codex:**
- `codex exec --ephemeral --json -s read-only`, con el encargo por la entrada estándar. Así no guarda la sesión y no puede escribir nada;
- la respuesta final, con forma fija (`--output-schema`);
- `OPENAI_API_KEY` vacía en el proceso hijo.

Antes de la primera llamada comprueba que `codex login status` diga «Logged in using ChatGPT». Si Codex tiene sesión con una clave de API, se niega a seguir.

**Al terminar:**
- mueve el PNG de `~/.codex/generated_images/<hilo>/` al destino;
- borra esa carpeta y la de trabajo;
- devuelve un JSON: `ruta`, `ancho`, `alto`, `bytes`, `sha256`, `segundos`, la `nota` de Codex, `hilo` y `tokens`.

**Mientras genera:** la línea de estado dice cuántos segundos lleva. Al acabar sale un aviso breve y, si tardó más de un minuto, una notificación del sistema.

## Instalación
En una sesión de Claude Code en la terminal:

```
/plugin install codex-imagenes --marketplace mendezorlando/codex-imagenes
```

Desde la terminal del sistema:

```bash
claude plugin install codex-imagenes --marketplace mendezorlando/codex-imagenes
```

En la app de escritorio: + junto al cuadro del prompt → Plugins → Add marketplace con `mendezorlando/codex-imagenes` → Add plugin.

Desde una copia local, la carpeta es su propio marketplace. Tras editarla, `/reload-plugins`:

```bash
claude plugin marketplace add <carpeta>
```

```bash
claude plugin install codex-imagenes@codex-imagenes --scope user
```

Para comprobarlo: `claude plugin validate <carpeta>` y `claude plugin test <carpeta>`.

## Requisitos
- Codex CLI en el `PATH` o en `~/.local/bin`, con la generación de imágenes activada (`codex features list` → `image_generation`).
- La sesión iniciada con tu cuenta de ChatGPT: `codex login`.
- macOS o Linux. Usa `file`, `shasum` o `sha256sum`, `mv`, `mkdir`, `rmdir` y `rm`.

## Límites
- Cuenta contra los límites de imágenes de tu plan de ChatGPT, y cada imagen tarda de 1 a 3 minutos.
- Si interrumpes la llamada, Codex sigue hasta acabar o hasta su límite de 10 minutos.
