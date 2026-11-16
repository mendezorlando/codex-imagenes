# codex-imagenes

Generates images with **your ChatGPT subscription**, through Codex CLI and its built-in `image_gen` tool. It never uses the API or a key. (*Imágenes* is Spanish for "images".)

## What it does
It registers the tool `generate` (`mcp__codex-imagenes__generate`). Claude calls it with:
- **`prompt`:** what the image must show;
- **`output`:** a `.png`;
- **`references`** (optional): up to 8 images, to keep a character, a product or a style;
- **`size`** (optional): `1536x1024`, `1024x1536` or `1024x1024`;
- **`overwrite`** (optional).

**How it calls Codex:**
- `codex exec --ephemeral --json -s read-only`, with the prompt on standard input. So it saves no session and cannot write anything;
- the final answer has a fixed shape (`--output-schema`);
- `OPENAI_API_KEY` is blanked in the child process.

Before the first call it checks that `codex login status` says «Logged in using ChatGPT». If Codex is signed in with an API key, it refuses to go on.

**When it finishes:**
- it moves the PNG from `~/.codex/generated_images/<thread>/` to the output;
- it removes that folder and the work folder;
- it returns JSON: `path`, `width`, `height`, `bytes`, `sha256`, `seconds`, Codex's `note`, `thread` and `tokens`.

**While it generates:** the status line shows how many seconds it has taken. When done, a short toast appears and, if it took more than a minute, a system notification.

## Install
In a Claude Code session in the terminal:

```
/plugin install codex-imagenes --marketplace mendezorlando/codex-imagenes
```

From a shell:

```bash
claude plugin install codex-imagenes --marketplace mendezorlando/codex-imagenes
```

In the desktop app: + next to the prompt box → Plugins → Add marketplace with `mendezorlando/codex-imagenes` → Add plugin.

From a local copy, the folder is its own marketplace. After editing it, `/reload-plugins`:

```bash
claude plugin marketplace add <folder>
```

```bash
claude plugin install codex-imagenes@codex-imagenes --scope user
```

To check it: `claude plugin validate <folder>` and `claude plugin test <folder>`.

## Requirements
- Codex CLI on the `PATH` or in `~/.local/bin`, with image generation enabled (`codex features list` → `image_generation`).
- Signed in with your ChatGPT account: `codex login`.
- macOS or Linux. It uses `file`, `shasum` or `sha256sum`, `mv`, `mkdir`, `rmdir` and `rm`.

## Limits
- It counts against your ChatGPT plan's image limits, and each image takes 1 to 3 minutes.
- If you interrupt the call, Codex keeps going until it finishes or hits its 10-minute limit.

## License
MIT.
