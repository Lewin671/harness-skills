# Excalidraw in Obsidian

Read only when creating or updating Excalidraw drawings.

## Excalidraw workflow

- First confirm the plugin is installed and enabled: `obsidian plugins filter=community format=json`.
- Discover the live API instead of assuming method names. Start with:

```bash
obsidian eval code='Object.keys(app.plugins.plugins).filter(k=>k.includes("excalidraw"))'
obsidian eval code='const p=app.plugins.plugins["obsidian-excalidraw-plugin"]; Object.keys(p)'
obsidian eval code='const ea=window.ExcalidrawAutomate.getAPI(); const k=Reflect.ownKeys(Object.getPrototypeOf(ea)); ea.destroy(); k'
```

- Script with a private instance from `window.ExcalidrawAutomate.getAPI()` and call `ea.destroy()` when done. The plugin's shared `ea` object carries state other scripts and the plugin itself use.

- Prefer plugin API methods such as `ea.reset()`, `ea.addText()`, `ea.addArrow()`, `ea.addRect()`, and `ea.create()` over hand-authoring `.excalidraw.md` internals.
- Create the drawing as a separate `.excalidraw.md` file, then embed it into the target note with a wikilink embed such as `![[diagram.excalidraw.md]]`.
- When using `ea.create()`, pass explicit `filename`, `foldername`, and `silent: true` so the path is deterministic and scripts stay non-interactive.
- Reopen the generated file with `obsidian read path=...` after writing to confirm it was created: check the `excalidraw-plugin` frontmatter and the `## Text Elements` section. With the plugin's compression setting on, the drawing data is a `compressed-json` block, so do not expect readable elements.
- Treat `obsidian eval` plus the plugin API as the primary write path. Hand-edit the saved Markdown only as a last resort.
