# RoomCraft

RoomCraft is a home interior and custom-furniture designer. You lay out the room (floor plan,
walls and services), design built-in furniture to fit it, and get production-ready cut lists,
sheet layouts, a hardware list, a cost estimate and PDF drawings.

It is built with React, TypeScript and Vite, uses react-konva for the 2D plan and
three.js / @react-three/fiber for 3D, and keeps state in Zustand + immer with undo/redo. Projects
autosave to IndexedDB. Exports use jsPDF and write-excel-file.

## Run it

```bash
cd roomcraft
npm install
npm run dev        # http://localhost:5173 (also served on your LAN for tablets and phones)
npm test           # unit + integration tests (vitest)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

For a quick tour, open **File → Load sample kitchen**. It loads an L-shaped kitchen that uses
every feature. Press `?` at any time to replay the guided tour.

## Workflow (left sidebar)

| Step | What you can do |
|---|---|
| 1 Floor plan | Draw rooms by clicking corners, or add a rectangle / L / U template by size. Points snap to the grid, 45°/90° and walls. Lengths show live; click a label to type a new length. |
| 2 Walls | Set thickness (230 mm default) and height (3000 mm default) for all walls or one wall. |
| 3 Services & structure | Add doors (hinge side, swing in/out), windows (sill height) and openings. Add sockets, switches, light and AC points, hot/cold water, drain and gas, each with a height from the floor. Add columns and beams (width, depth, underside height). Set floor/ceiling slabs, skirting and a drop ceiling. Everything shows as a symbol in 2D and as a model in 3D. |
| 4 Furniture | Parametric modules: base, wall, tall/pantry, blind corner, drawer, sink unit, open shelf; wardrobe (hinged or sliding, configurable sections, loft); bed (with or without storage), TV unit, bookshelf, study table, shoe rack, dressing table, vanity. Board thickness (6–25 mm) can be set for the project, a module or a single panel. Choose the board material, laminate/veneer finish, edge banding per edge, handle style and grain. Hardware is counted automatically. |
| 5 Appliances | Sinks, hob, hood, oven, microwave, fridge, dishwasher, small appliances, washer, TV, AC, geyser, all at standard sizes. Sinks and hobs cut the countertop. Ovens and microwaves turn the doors and shelves of the cabinet they sit in into an opening with a support shelf. |
| 6 Countertop | Choose marble, granite, quartz or solid surface. Set thickness, front and side overhang and backsplash. Sink and hob cut-outs are made automatically, L/U corners get butt joints, and pieces are nested onto stone slabs. |
| 7 Outputs | Cut list (finished and cut sizes, material, finish, edge banding, grain, quantity) exported as CSV or Excel. Sheet optimisation with kerf, trim and grain. Hardware list. Editable price list with totals per module and for the project. PDF with the floor plan, wall elevations, 3D snapshot, cut list, sheet layouts, countertop and cost. |

### Smart features
- **Clash detection** (top-bar badge). Warns when furniture covers a socket or switch, blocks a
  pipe or gas line, hits a beam or column, blocks a door swing or window, overlaps other
  furniture, or sticks into a wall. Clashing items are outlined red in 2D and 3D.
- **Suggestions**:
  - Move the sink unit near the water and drain points (one click).
  - Add a hood above the hob, or centre it over the hob.
  - Keep tall units at the ends of a run.
  - Add sockets above the worktop.
  - Keep the hob within reach of the gas line.
  - Leave clearance above the hob.
  - Don't put the fridge next to the hob.
- **Views**: 2D, 3D, split, and plan + wall elevation with dimension chains.
  - In 3D, walls facing the camera fade (dollhouse view).
  - First-person walkthrough: WASD/arrows or the on-screen pad, drag to look.
  - Click any panel in 3D to edit it.
  - Exploded view of a module.
- **Editing**: measure tool; copy/paste/duplicate; mirror (swaps hinge side); rotate.
  Shift-click modules and use *Group into run* so they move together.
- **Snapping**: modules snap their back to the nearest wall, turn to face the room and butt
  against their neighbours.
- **Layers**: furniture, electrical, plumbing, structure, dimensions, ceilings.
- **General**: undo/redo with named commands, keyboard shortcuts, tooltips, first-time guided
  tour, dark/light mode, mm / cm / m / ft-in display (inputs accept any unit, e.g. `2.4m`,
  `8' 6"`), and touch (tap to place, drag, pinch-zoom).

### Keyboard shortcuts
`V` select · `D` draw room · `M` measure · `H` pan · `R` rotate (Shift: other way) · `X` mirror ·
`E` explode · `F` fit · `1`/`2`/`3`/`4` 2D / split / 3D / elevation · arrows nudge 10 mm (Shift: 100) ·
`Ctrl+C`/`V`/`D` copy / paste / duplicate · `Delete` · `Ctrl+Z` / `Ctrl+Shift+Z` · `Ctrl+S` save .json · `?` tour

## Architecture

```
src/model/                 pure, unit-tested logic (no React)
  types.ts                 Project → rooms, openings, services, beams, columns, modules, appliances, …
  units.ts                 mm internally; format/parse mm, cm, m, ft-in
  geometry.ts, snapping.ts polygon maths, mitred walls, snapping pipeline
  structure.ts             wall frames, openings → 3D wall pieces, placement transforms, SAT overlap
  furniture/engine.ts      parametric engine: panels, edge banding, grain, cut sizes, hardware, appliance spaces
  furniture/modules.ts     module definitions (data + small build recipes using carcass/doors/drawers/shelves helpers)
  appliances.ts, catalog.ts  appliance sizes, materials, finishes, stones, hardware, default prices
  countertop.ts            runs → pieces, L/U butt joints, overhangs, cut-outs, slab layout
  nesting.ts               MaxRects sheet nesting with kerf, trim and grain lock
  cutlist.ts, cost.ts      cut list, sheet groups, hardware list, cost estimate
  checks.ts                clash detection + suggestions
  elevation.ts             wall elevation data (shared by the on-screen view and the PDF)
src/store/                 project store (command history), UI/prefs store, actions, derived data, persistence
src/plan2d/                Konva plan editor, layers, placement & snapping of library items
src/view3d/                three.js scene, walkthrough
src/components, src/steps  inspectors, libraries, reports, elevation view, checks, tour, step panels
src/export/                PDF, Excel and CSV exports
```

### Adding a furniture type
Add one entry to `MODULES` in `src/model/furniture/modules.ts`. Give it an `id`, a name,
a category, a `kind` (`base` / `wall` / `tall` / `free`), default size and limits, a `params`
list (these become the UI controls) and a `build(c)` recipe. The recipe composes the helpers
(`carcass`, `doors`, `drawers`, `shelves`, `partition`, `divider`) or calls `c.panel({...})`
directly. The cut list, edge banding, hardware, nesting, cost, 3D, elevations and PDF all follow
from the panels it generates.

Notes:
- Cut sizes subtract edge banding that is 1 mm or thicker; 0.45/0.8 mm tapes are not deducted.
- Default prices are indicative (₹ by default). Edit them in Outputs → Cost; they are saved
  with the project.
