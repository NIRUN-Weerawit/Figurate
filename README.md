# Figurate

> A web-based editor for precise scientific and academic diagrams — pick primitives from a library, snap them together with semantic relations, edit by hand or via the JSON DSL.

![Figurate banner](https://placeholder.pics/600/200) <!-- TODO real banner -->

## Spike (current state)

This is the **spike build** — a minimal end-to-end demo proving that:

- ✅ A primitive library (mechanics, fields, optics, etc.) can be the foundation
- ✅ A JSON DSL is a clean, parseable, editable scene format
- ✅ A web GUI round-trips with the DSL (drag objects, edit params, see JSON update)
- ✅ A constraint solver (`kiwi.js`) handles semantic relations
- ✅ KaTeX-ready math labels render
- ✅ SVG export is clean and re-editable

### Demo scenes included

- **Pendulum at 30°** — pivot, rope, bob, angle arc, tension & weight vectors
- **Block on 25° incline** — incline, block, gravity / normal / friction vectors
- **Free-body diagram** — point mass + 3 force vectors

### Try it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

### How it works

1. **Pick a primitive** from the left sidebar (pendulum bob, incline, block, vector, etc.) → it gets added to the canvas.
2. **Click the object** to select it. The right inspector shows its parameters — change the angle, length, mass, color, etc.
3. **Drag the object** on the canvas to reposition it. The constraint solver re-runs every frame so dependent objects (vectors attached to the bob, blocks resting on inclines) follow.
4. **Edit the JSON** in the bottom panel if you want full control.
5. **Export SVG or JSON** from the toolbar.

### Architecture

```
src/
├── core/
│   ├── dsl.ts        — JSON DSL types (FigurateScene, SceneObject, Relation)
│   ├── registry.ts   — primitive definitions + category grouping
│   ├── solver.ts     — kiwi.js-based constraint solver
│   └── scene.ts      — Zustand+Immer store with undo/redo
├── primitives/
│   └── index.ts      — all 10 spike primitives
├── render/
│   └── SceneRenderer.tsx — turns JSON into SVG
├── ui/
│   ├── Library.tsx   — left sidebar palette
│   ├── Inspector.tsx — right sidebar property editor
│   ├── DSLEditor.tsx — bottom JSON editor
│   └── Toolbar.tsx   — top toolbar
├── samples.ts        — 3 pre-built demo scenes
├── App.tsx           — main layout
├── main.tsx          — entry point
└── styles.css        — base styles
```

### What comes after the spike

- 🔲 Python FastMCP server so AI agents can build scenes
- 🔲 More primitives (50+ across mechanics, fields, optics, circuits)
- 🔲 Pre-built scene templates (10+)
- 🔲 Cloudflare Pages deploy + custom domain
- 🔲 Auth + scene storage (Clerk + Supabase)
- 🔲 Subscription model (Free / Pro / Team)
- 🔲 Marketplace for community-contributed scenes (Year 2)

### License

MIT. See [LICENSE](./LICENSE).

### Credits

Built with [React](https://react.dev), [Vite](https://vitejs.dev), [kiwi.js](https://github.com/lume/kiwi), [Zustand](https://zustand-demo.pmnd.rs/), [KaTeX](https://katex.org/).

Inspired by [patatrac](https://github.com/ZaninDavide/patatrac) and [Inknertia](https://github.com/ploliver/inknertia) (both MIT-licensed Typst libraries we're porting primitive ideas from).