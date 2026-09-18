# Blueprint source

`docs/blueprint.html` (≈640 KB, ≈200K tokens) is a **build artifact**. It is generated from the small files under `parts/` and must never be read or edited directly — `.claude/settings.json` denies it. Edit the part, rebuild, commit both.

```
node docs/blueprint/build.mjs           # rebuild + validation report
node docs/blueprint/build.mjs --check   # verify the artifact is current (exit 1 if not)
node docs/blueprint/build.mjs --list    # print the resolved part order
```

The build is a byte-exact concatenation of the parts in `manifest.json` order (no dependencies, Node ≥ 18). The report checks tag balance, duplicate ids and JavaScript syntax of the three script blocks.

## Layout (`parts/`)

| Path | Content | Typical size |
|---|---|---|
| `00-head.html` … `99-tail.html` | Fixed HTML skeleton (head, body start, main end, script tags). Rarely changes. | tiny |
| `css/site-NN-*.css` | Document styles, one file per `/* ---- block ---- */` of the original stylesheet | 0.3–4 KB |
| `css/mock-NN-*.css` | Mockup styles (shell, controls, tables, phones) | 0.3–6 KB |
| `sections/NN-<id>-<title>.html` | One `<section class="doc-section">` per file, in document order (`legenda`, `s01`…`s48`, `anexo-a`…`anexo-e`). A file also carries the `part-title` divider that precedes it. | 1–11 KB |
| `sections/50-anexo-b-mockups-visuais/` | Annex B split further: `00-open.html`, one `NN-mk-*.html` per `<figure class="mock-fig">`, `99-close.html` | 1–12 KB |
| `screens/000-header.js` | Status vars (`P02`, `AUTH1`, …) and `window.SCREENS = [` | 2.5 KB |
| `screens/NNN-<id>-<name>.js` | One screen catalog entry each (`W-xx` web, `M-xx` mobile, `C-xx`, `A-xx`). Each file is one object literal ending in `},` — not standalone JS. | ~1 KB |
| `screens/999-footer.js` | `];` and the IIFE close | tiny |
| `data/NN-<name>.js` | Blueprint datasets, one `window.X = …;` per file: `version`, `profiles`, `modules`, `rf`, `perm`, `scope`, `flows`, `states`, `open` | 0.2–23 KB |
| `app/app.js` | Rendering and interaction code | 35 KB |

## Editing rules

- Find the part, don't browse: `grep -ril "revisão de preço" docs/blueprint/parts` or `grep -rl "id: 'W-12'" docs/blueprint/parts/screens`.
- Keep each file's boundaries: a section file starts at `<section` and ends at `</section>` (plus the divider for the next part); a screen file is exactly one entry ending in `},`; a data file is exactly one `window.X = …;` statement.
- **Add a section:** create `sections/NN-<id>-<slug>.html` with a number that sorts into the right place (two digits; renumber neighbours if needed) and include the `<div class="part-title">` divider if it opens a new part.
- **Add a screen:** create `screens/NNN-<id>-<slug>.js` with the next number before `999-footer.js`; the group comments (`/* ===== MOBILE ===== */`) live at the top of the first file of each group.
- **Add a mockup:** create `sections/50-anexo-b-mockups-visuais/NN-mk-<id>-<slug>.html` between `00-open.html` and `99-close.html`.
- **Add a dataset:** create `data/NN-<name>.js`; `data/*.js` is picked up automatically in name order.
- New files under a globbed directory need no manifest change; a new fixed part (e.g. another script tag) needs a `manifest.json` entry.
- Always finish with `node docs/blueprint/build.mjs`; a non-zero exit means the artifact was not written or a check failed — fix the part, never the artifact.
