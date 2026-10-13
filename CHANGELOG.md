# Changelog

## v0.4.0 — 2026-10-13

Feature parity with MarginNote's built-in pen mode (checked item by item against MN 4.4.6):

- **Tool slots like MarginNote**: any number of pens / highlighters; *Clone As New Tool* and *Delete*; keys 1–9.
- **Pen types**: normal, mono, fountain, brush, pencil, **watercolor**, **crayon** (MN: Normal / Mono / Fountain / Pencil / Water / Crayon).
- Per-tool **opacity**, separate **sizes for mind map and PDF** (MN: Doc / Map), **straight line Off / Auto / Always**, **vanish mode**, **perfect shape** toggle.
- **Ruler**: drag / rotate (15° steps), strokes started at its edge are drawn straight along it.
- **Eyedropper** in the colour row and palette.
- **Sketch layers**: create, rename, hide, delete; drawing / erasing / lasso act on the active layer (stored in the notebook, undoable).
- **Hand tool** for panning; **double tap a card to focus**; two-finger tap = undo, three-finger tap = redo.
- **Bind handwriting to the selected card** option, and *bind selection to a card* from the lasso.
- **Lasso → Create Card**: the selection becomes a new card holding it as an image (one undo step).

## v0.3.0 — 2026-10-12

First public release.

- **Deep MarginNote integration**: ink is stored in a hidden note inside the notebook (covered by MarginNote backups, iCloud sync and exports); every edit is one step of MarginNote's undo history and the toolbar undo / redo are MarginNote's; MarginNote's own pen buttons open MN Ink and its pen is switched off while writing. Ink from v0.1–0.2 (local file) is migrated automatically.
- **PDF pages**: write on documents (vertical scroll mode); ink anchored to page segments, survives page-view recycling and zoom.
- **Shapes**: arcs and one-stroke arrows; hold-and-drag adjusts arc sweep and arrow length.
- **Lasso, GoodNotes style**: selects anything it touches; freehand or rectangle; type filters; rotate handle; copy / cut / tap-to-paste.
- **Settings**: pressure sensitivity 0–100 %, size presets 10–400 %, recent colours, hex colour input.
- **Laser pointer** for presenting.
- Mind maps whose scroll view became a PencilKit canvas (after using MarginNote's own pen) are supported.

## v0.2.0

Brushes (fountain, ballpoint, brush, pencil), writing paper, √ tidy-up, hold-and-drag shape adjusting, node / grid snapping, shape tool with dashed lines, lasso move / resize / node editing / duplicate, partial and highlighter-only eraser, palette, redesigned toolbar.

## v0.1.0

Prototype: pressure pen and highlighter on mind maps, shape snapping, eraser, lasso move.
