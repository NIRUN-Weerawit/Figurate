/**
 * Scene state — Zustand + Immer store with undo/redo.
 *
 * The store holds the canonical FigurateScene. Every mutation goes through
 * Immer drafts so we get immutable updates for free. Past scenes live in
 * two stacks (undo, redo) for instant <50ms history traversal.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { nanoid } from "nanoid";
import type { FigurateScene, SceneObject } from "./dsl";
import { defaultParams, defaultTransform } from "./registry";
import { ConstraintSolver } from "./solver";

const HISTORY_LIMIT = 100;

interface HistoryEntry {
  scene: FigurateScene;
  label: string;
}

interface SceneState {
  scene: FigurateScene;
  selectedId: string | null;
  past: HistoryEntry[];
  future: HistoryEntry[];

  // mutations
  addObject: (type: string, position?: { x: number; y: number }) => string;
  updateObject: (id: string, patch: Partial<SceneObject>) => void;
  updateParams: (id: string, params: Record<string, unknown>) => void;
  updateTransform: (id: string, transform: Partial<SceneObject["transform"]>) => void;
  setTransform: (id: string, transform: Partial<SceneObject["transform"]>) => void;
  removeObject: (id: string) => void;
  select: (id: string | null) => void;

  // history
  undo: () => void;
  redo: () => void;

  // scene-wide
  loadScene: (scene: FigurateScene, label?: string) => void;
  resetScene: () => void;
  solve: () => void;

  // serialization
  exportJSON: () => string;
  importJSON: (text: string) => void;
}

const DEFAULT_SCENE: FigurateScene = {
  version: "0.1.0",
  meta: { title: "Untitled", subject: "physics:mechanics" },
  canvas: { width: 900, height: 600, background: "#fafafa", grid: { enabled: true, spacing: 20, color: "#e8e8e8" } },
  objects: [],
};

export const useSceneStore = create<SceneState>()(
  immer((set, get) => {
    const solver = new ConstraintSolver();

    function pushHistory(label: string): void {
      set((draft) => {
        // deep copy via JSON (fast enough for spike)
        const snap = JSON.parse(JSON.stringify(draft.scene)) as FigurateScene;
        draft.past.push({ scene: snap, label });
        if (draft.past.length > HISTORY_LIMIT) draft.past.shift();
        draft.future = [];
      });
    }

    return {
      scene: DEFAULT_SCENE,
      selectedId: null,
      past: [],
      future: [],

      addObject: (type, position) => {
        const id = `${type}_${nanoid(6)}`;
        pushHistory(`add ${type}`);
        set((draft) => {
          draft.scene.objects.push({
            id,
            type,
            params: defaultParams(type),
            transform: position ?? defaultTransform(type),
            zIndex: draft.scene.objects.length,
          } as SceneObject);
          draft.selectedId = id;
        });
        get().solve();
        return id;
      },

      updateObject: (id, patch) => {
        pushHistory("update object");
        set((draft) => {
          const obj = draft.scene.objects.find((o) => o.id === id);
          if (!obj) return;
          Object.assign(obj, patch);
        });
      },

      updateParams: (id, params) => {
        pushHistory("edit params");
        set((draft) => {
          const obj = draft.scene.objects.find((o) => o.id === id);
          if (!obj) return;
          Object.assign(obj.params, params);
        });
        get().solve();
      },

      updateTransform: (id, transform) => {
        // for drag operations: don't push history every frame
        set((draft) => {
          const obj = draft.scene.objects.find((o) => o.id === id);
          if (!obj) return;
          Object.assign(obj.transform, transform);
        });
      },

      setTransform: (id, transform) => {
        // for inspector edits: record history, then re-solve so dependent
        // objects follow (e.g. moving a pivot moves its bob).
        pushHistory("set transform");
        set((draft) => {
          const obj = draft.scene.objects.find((o) => o.id === id);
          if (!obj) return;
          Object.assign(obj.transform, transform);
        });
        get().solve();
      },

      removeObject: (id) => {
        pushHistory("remove object");
        set((draft) => {
          draft.scene.objects = draft.scene.objects.filter((o) => o.id !== id);
          if (draft.selectedId === id) draft.selectedId = null;
        });
      },

      select: (id) => {
        set((draft) => {
          draft.selectedId = id;
        });
      },

      undo: () => {
        set((draft) => {
          const prev = draft.past.pop();
          if (!prev) return;
          const current = JSON.parse(JSON.stringify(draft.scene)) as FigurateScene;
          draft.future.push({ scene: current, label: "undo target" });
          draft.scene = prev.scene;
        });
      },

      redo: () => {
        set((draft) => {
          const next = draft.future.pop();
          if (!next) return;
          const current = JSON.parse(JSON.stringify(draft.scene)) as FigurateScene;
          draft.past.push({ scene: current, label: "redo target" });
          draft.scene = next.scene;
        });
      },

      loadScene: (scene, label = "load scene") => {
        pushHistory(label);
        set((draft) => {
          draft.scene = scene;
          draft.selectedId = null;
        });
        get().solve();
      },

      resetScene: () => {
        pushHistory("reset");
        set((draft) => {
          draft.scene = JSON.parse(JSON.stringify(DEFAULT_SCENE)) as FigurateScene;
          draft.selectedId = null;
        });
      },

      solve: () => {
        // run the solver via a writeBack callback so Immer mutations are
        // detected (the scene passed in is frozen)
        const scene = get().scene;
        set((draft) => {
          const warnings = solver.solve(draft.scene, (id, x, y) => {
            const obj = draft.scene.objects.find((o) => o.id === id);
            if (obj) {
              obj.transform.x = x;
              obj.transform.y = y;
            }
          });
          if (warnings.length > 0) {
            // eslint-disable-next-line no-console
            console.warn("Solver warnings:", warnings);
          }
        });
        // touch scene reference so subscribers re-render
        // (set() with no changes won't trigger; force a noop patch)
        set((draft) => {
          draft.scene.meta.title = draft.scene.meta.title;
        });
      },

      exportJSON: () => {
        return JSON.stringify(get().scene, null, 2);
      },

      importJSON: (text) => {
        try {
          const parsed = JSON.parse(text) as FigurateScene;
          get().loadScene(parsed, "import");
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("Failed to parse JSON:", err);
        }
      },
    };
  })
);