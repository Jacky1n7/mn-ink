# Changelog

## v0.5.0 — 2026-10-14

- **Scribble to erase** (as in GoodNotes): scribble over pen strokes — a zig-zag across the words, an up-and-down run or a row of loops — and they go away together with the scribble (one undo step). Only pen strokes on the active layer, mostly under the scribble, are erased; highlighter stays. A scribble over nothing is kept as ink. Switch: Settings → 涂抹擦除.
- **Palm rejection on iPad**: a hand resting on the screen no longer pans / zooms the view or triggers the two-finger-tap undo. Touches the system cancels never count as taps, touches during and right after Pencil strokes are ignored, very large contacts are ignored, and the two-/three-finger taps must be deliberate.
- **Arc ends snap**: both ends of a recognised arc snap to nearby nodes / grid points (the arc keeps its shape), and a nearly level or upright chord is made exact.
- **MarginNote's pen button is now an MN Ink on/off switch** (takeover on): MarginNote's own action is taken off the button, so tapping it no longer enters MarginNote's handwriting mode (no zoom jump, no MarginNote paper background, no tool picker); the button lights up while MN Ink is open. Switching the takeover off gives the button back.
- **Settings → 暂时用 MN 自带笔**: to edit handwriting written with MarginNote's own pen; the takeover comes back when MarginNote's handwriting mode is left.
- Dev channel: snippets travel in the URL instead of the clipboard (it no longer shows up on other devices through Universal Clipboard).

## v0.4.2 — 2026-10-13

- **Dots off the cards land at once**: only a tap on a card is held back (~0.3 s) to see whether it becomes a double tap; anywhere else a dot is drawn immediately. The add-on now tells the drawing page where the cards are.
- If the card never gets selected, double tap now says so instead of silently doing nothing (and never focuses another card).
- A held dot is always sent before the next stroke, so stroke order (and undo order) is kept.
- Double tapping the card that is already focused leaves the focus view (MarginNote's Focus command toggles).

## v0.4.1 — 2026-10-13

- **Double tap a card now really enters MarginNote's focus view** (selects the card, then runs MarginNote's own Focus command), with any tool: finger double tap, mouse double click, or two quick Pencil taps on the same spot — the taps no longer leave two dots behind (a single tap is still a dot).
- **Dragging a snapped arc keeps its start fixed**: the arc keeps its shape and is scaled / turned about its start point, following the pen like a line's end; the end snaps to nodes and grid points.

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
