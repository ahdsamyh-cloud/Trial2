# RoomCraft

Home interior and custom-furniture designer: lay out the room (floor plan, walls, services),
design built-in furniture to fit it, and get production-ready cut lists.

React + TypeScript + Vite · react-konva (2D plan) · three.js / @react-three/fiber (3D) ·
Zustand + immer (state, undo/redo) · IndexedDB autosave.

## Run it

```bash
cd roomcraft
npm install
npm run dev        # http://localhost:5173 (also on your LAN, so you can open it on a tablet/phone)
npm test           # unit tests (vitest)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

## Status: phase 1 of 6 (floor plan + walls, 2D + 3D)

| Step | Status |
|---|---|
| 1 Floor plan | ✅ draw rooms by clicking corners, or by width × length; rectangle, L and U templates |
| 2 Walls | ✅ thickness (default 230 mm) and height (default 3000 mm), set globally or per wall |
| 3 Services & structure | phase 2 |
| 4 Furniture | phase 3 |
| 5 Appliances, 6 Countertop | phase 4 |
| 7 Outputs (cut list, sheets, cost, PDF) | phase 5 |

### Using the editor
- **Draw room** (`D`): click or tap each corner. Points snap to the grid, to 45°/90° and to existing walls and corners,
  and the length and angle show as you go. Type a number (any unit, e.g. `3.2m`, `8' 6"`) to set the
  next wall's length. Close the room on its first corner or with `Enter`; `Backspace` removes the last point.
- **Select** (`V`): click a room, then drag it to move it (it snaps to other rooms) or drag its corners.
  Click a **dimension label** and type a new length. Double-click a wall to add a corner, and use `Delete` to remove one.
- Pan by dragging the empty plan, with right/middle-drag or with `Space`+drag. Zoom with the wheel, a pinch or the +/− buttons. `F` fits the view.
- Views: `1` 2D · `2` split · `3` 3D. Clicking a wall or floor in 3D selects it.
- `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo (the button tooltips name each command) · `Ctrl+S` saves a .json file.
- Units (mm / cm / m / ft-in) and dark mode are in the top bar, or in the File menu on phones.

## Architecture
```
src/model/       pure, tested logic (no React)
  types.ts       Project → Room (inner-face polygon, positive orientation) → Wall (id, thickness, height)
  units.ts       formatLength / parseLength (mm internally; mm, cm, m, ft-in display)
  geometry.ts    polygon maths, mitred wall offsets (wall footprints), intersection tests
  snapping.ts    grid → angle lock → alignment → wall faces → corners
  room.ts        room operations (templates, set wall length, corners), file migration
src/store/       projectStore (command history, gestures), uiStore (prefs + UI), actions, persistence
src/plan2d/      Konva plan editor (pointer and pinch handling, dimension editing)
src/view3d/      three.js scene (extruded walls, floors)
src/steps/       wizard step panels
```
Walls store a stable `id` so that doors, services and furniture can attach to them in later phases.
