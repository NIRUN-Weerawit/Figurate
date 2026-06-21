/**
 * Scene state — Zustand + Immer store with undo/redo.
 *
 * The store holds the canonical FigurateScene. Every mutation goes through
 * Immer drafts so we get immutable updates for free. Past scenes live in
 * two stacks (undo, redo) for instant <50ms history traversal.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

/**
 * Generate a simple, human-readable id for a new object of the given type.
 * Format: `<type_prefix><N>` where N is the next available counter for
 * that type. Examples: `bob1`, `pivot2`, `block1`, `theta_arc1`.
 *
 * The counter is per-type and persisted in the scene's `idCounters` map.
 * Counters are NOT serialized to disk; they're recomputed on load by
 * scanning existing objects, so deleting an object doesn't shift other
 * objects' numbers.
 *
 * If the desired id is already taken, N is incremented until a free
 * one is found (defensive — shouldn't happen in normal flow).
 */
function nextSimpleId(
  state: { idCounters: Record<string, number>; scene: { objects: { id: string }[] } },
  type: string
): string {
  // If the counter hasn't been initialized for this type, scan existing
  // objects to find the max N. This handles scenes loaded from disk
  // (where the counter doesn't exist) and scenes where the user deleted
  // the most recent object (so the counter from a previous session
  // would be too low).
  if (state.idCounters[type] === undefined) {
    let maxN = 0;
    const prefix = type;
    for (const o of state.scene.objects) {
      if (!o.id.startsWith(prefix)) continue;
      const tail = o.id.slice(prefix.length);
      const n = parseInt(tail, 10);
      if (!Number.isNaN(n) && n > maxN) maxN = n;
    }
    state.idCounters[type] = maxN;
  }
  state.idCounters[type] += 1;
  let candidate = `${type}${state.idCounters[type]}`;
  // Defensive: if the id is taken (e.g. user manually renamed), increment
  // until a free one is found.
  const taken = new Set(state.scene.objects.map((o) => o.id));
  while (taken.has(candidate)) {
    state.idCounters[type] += 1;
    candidate = `${type}${state.idCounters[type]}`;
  }
  return candidate;
}
import type { FigurateScene, SceneObject } from "./dsl";
import { defaultParams, defaultTransform, getPrimitive } from "./registry";
import { inferRoles } from "./inference";
import { ConstraintSolver } from "./solver";
import { recomputeAll, type DerivedCache, type Derivation, type FieldRef } from "./derivation";
import { buildSceneDerivations } from "./derivations";
import { findNonOverlappingPosition } from "./layout";

const HISTORY_LIMIT = 100;

interface HistoryEntry {
  scene: FigurateScene;
  label: string;
}

interface SceneState {
  scene: FigurateScene;
  /** Derived-value cache: params/transform fields that are computed from
   *  other objects (e.g. the tension vector's angle is derived from the
   *  bob→pivot direction). The renderer reads this instead of `params`
   *  for any field that has a derivation rule. */
  derived: DerivedCache;
  /** Primary selection (for inspector + single-object operations). */
  selectedId: string | null;
  /** All selected object ids (for multi-select operations like group drag, delete, group transform). */
  selectedIds: string[];
  past: HistoryEntry[];
  future: HistoryEntry[];

  // mutations
  addObject: (type: string, position?: { x: number; y: number }) => string;
  updateObject: (id: string, patch: Partial<SceneObject>) => void;
  updateParams: (id: string, params: Record<string, unknown>) => void;
  updateTransform: (id: string, transform: Partial<SceneObject["transform"]>) => void;
  setTransform: (id: string, transform: Partial<SceneObject["transform"]>) => void;
  /** Like setTransform but also re-solves constraints. For Inspector edits. */
  setTransformAndSolve: (id: string, transform: Partial<SceneObject["transform"]>) => void;
  /** Apply a snap target — create the relation, set the position, and
   *  re-run inference. Called by the renderer on mouseup when the user
   *  dropped an object onto a snap target. */
  applySnap: (candidate: import("./snap").SnapCandidate) => void;
  removeObject: (id: string) => void;
  /** Toggle visibility on a single object. */
  setVisible: (id: string, visible: boolean) => void;
  /** Toggle visibility on every object in a composite (sharing the same compositeOf). */
  setCompositeVisible: (compositeOf: string, visible: boolean) => void;
  /** Toggle visibility on every decoration of a given role within a composite. */
  setRoleVisible: (compositeOf: string, role: string, visible: boolean) => void;
  // ── Free-body diagram (FBD) state ──
  /** Map of `objectId → Record<key, value>`. The store-only state for
   *  the FBD overlay. Keys:
   *    "_visible"  : master toggle (boolean)
   *    "<type>"    : per-force enabled flag (boolean)
   *    "_mag_<t>"  : per-force magnitude override (number)
   *    "_dir_<t>"  : per-force direction override (number, degrees)
   *  Not stored in the scene file. */
  fbdEnabled: Record<string, Record<string, unknown>>;
  /** Master toggle: is the FBD overlay shown for this object? */
  setFbdVisible: (objectId: string, visible: boolean) => void;
  /** Toggle a single force type for an object. */
  setFbdForceEnabled: (objectId: string, forceType: string, enabled: boolean) => void;
  /** Update the magnitude of a force in the FBD. */
  setFbdForceMagnitude: (objectId: string, forceType: string, magnitude: number) => void;
  /** Update the direction (degrees) of a force in the FBD. */
  setFbdForceDirection: (objectId: string, forceType: string, directionDeg: number) => void;
  // ── Global FBD force visibility (per force type, applies to all objects) ──
  /** Map of `forceType → enabled`. When a force type is enabled here, it
   *  is shown on every object that has that force, regardless of selection.
   *  Stored alongside the per-object FBD state but at the top level. */
  fbdGlobalEnabled: Record<string, boolean>;
  /** Toggle a force type globally. */
  setFbdGlobalEnabled: (forceType: string, enabled: boolean) => void;
  /** Move an object's transform by a delta in world coords (used for group drag). */
  nudge: (ids: string[], dx: number, dy: number) => void;

  // selection
  select: (id: string | null) => void;
  /** Toggle an id in the multi-select set. Pass `id: null` to clear all. */
  toggleSelect: (id: string) => void;
  /** Replace the selection set entirely. */
  setSelection: (ids: string[]) => void;
  /** Per-type id counters used by `addObject` to produce bob1, bob2, etc.
   *  Not serialized; rebuilt on load by scanning existing objects. */
  idCounters: Record<string, number>;
  // ── Viewport (zoom / pan) ──
  viewport: { x: number; y: number; zoom: number };
  setViewport: (vp: Partial<{ x: number; y: number; zoom: number }>) => void;
  resetViewport: () => void;
  /** Add all ids whose (x,y) falls inside the rect (in world coords). */
  selectInRect: (rect: { x: number; y: number; w: number; h: number }) => void;

  // history
  undo: () => void;
  redo: () => void;
  /** Record a "drag end" snapshot — the caller is doing live drag updates and wants to checkpoint. */
  commit: (label?: string) => void;

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
      derived: {} as DerivedCache,
      selectedId: null,
      selectedIds: [],
      past: [],
      future: [],
      // Per-type id counters, used by `nextSimpleId` to generate bob1,
      // bob2, etc. Not serialized; rebuilt on load.
      idCounters: {},
      // Viewport: pan offset (x, y) and zoom level. Default identity.
      viewport: { x: 0, y: 0, zoom: 1.0 },

      addObject: (type, position) => {
        const def = getPrimitive(type);
        // Compute spawn position: use the explicit position, the canvas
        // center, or `defaultTransform()` (which falls back to center).
        const scene = get().scene;
        const cx = scene.canvas?.width ? scene.canvas.width / 2 : 450;
        const cy = scene.canvas?.height ? scene.canvas.height / 2 : 300;
        const spawnPos = position ?? { x: cx, y: cy };
        // Composite: insert the full group, return the anchor id.
        if (def?.composite) {
          const built = def.composite.build(spawnPos);
          // Build the placeholder → real-id map for the composite.
          // The first object (anchor) gets the anchor's simple id; the
          // rest are also simple: bob1, rope1, theta_arc1, etc.
          const roleToId = new Map<string, string>();
          const builtIds: string[] = [];
          const allObjects: SceneObject[] = [];
          for (let i = 0; i < built.length; i++) {
            const b = built[i];
            const realId = i === 0
              ? nextSimpleId(get(), def.composite.anchorType)
              : nextSimpleId(get(), b.type);
            builtIds.push(realId);
            roleToId.set(b.compositeRole, realId);
          }
          // Resolve placeholder targets like "<bob>", "<block>" inside params
          // and relations so the children actually wire up to each other.
          function resolvePlaceholders(value: unknown): unknown {
            if (typeof value === "string" && value.startsWith("<") && value.endsWith(">")) {
              const role = value.slice(1, -1);
              return roleToId.get(role) ?? value;
            }
            return value;
          }
          function resolveInParams(params: Record<string, unknown>): Record<string, unknown> {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(params)) out[k] = resolvePlaceholders(v);
            return out;
          }
          function resolveInRelations(rels: import("./dsl").Relation[] | undefined): import("./dsl").Relation[] | undefined {
            if (!rels) return undefined;
            return rels.map((r) => {
              if ("target" in r && typeof r.target === "string") {
                return { ...r, target: resolvePlaceholders(r.target) as string };
              }
              return r;
            });
          }

          pushHistory(`add composite ${type}`);
          set((draft) => {
            for (let i = 0; i < built.length; i++) {
              const b = built[i];
              allObjects.push({
                id: builtIds[i],
                type: b.type,
                params: resolveInParams(b.params),
                transform: b.transform,
                relations: resolveInRelations(b.relations),
                zIndex: draft.scene.objects.length,
                visible: true,
                // Group composite members by sharing the anchor's id.
                // This keeps the group tied to a real, human-readable
                // object id rather than an opaque nanoid.
                compositeOf: builtIds[0],
                compositeRole: b.compositeRole,
              } as SceneObject);
            }
            for (const o of allObjects) draft.scene.objects.push(o);
            draft.selectedId = builtIds[0];
            draft.selectedIds = [builtIds[0]];
          });
          get().solve();
          return builtIds[0];
        }
        // Plain primitive. Use a simple sequential id like bob1, bob2.
        const id = nextSimpleId(get(), type);
        pushHistory(`add ${type}`);
        set((draft) => {
          draft.scene.objects.push({
            id,
            type,
            params: defaultParams(type),
            transform: spawnPos,
            zIndex: draft.scene.objects.length,
            visible: true,
          } as SceneObject);
          draft.selectedId = id;
          draft.selectedIds = [id];
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

      /**
       * Update an object's transform WITHOUT solving. Used during drag —
       * we want the object to move freely without the constraint solver
       * snapping it back. The caller (renderer/App) is responsible for
       * calling `solve()` on mouseup via `onCommitDrag`.
       */
      setTransform: (id, transform) => {
        pushHistory("set transform");
        set((draft) => {
          const obj = draft.scene.objects.find((o) => o.id === id);
          if (!obj) return;
          Object.assign(obj.transform, transform);
        });
        // Drag-anchor: if the dragged object has a parametric source
        // (e.g. a pendulum bob with `pendulum_from`), update the
        // source parameter so the constraint holds the new position.
        // Without this, the solver would snap the object back to the
        // pre-drag position on mouseup.
        const obj = get().scene.objects.find((o) => o.id === id);
        if (obj && obj.relations) {
          for (const rel of obj.relations) {
            if (rel.kind === "pendulum_from" && obj.type === "pendulum_bob") {
              const target = get().scene.objects.find((o) => o.id === rel.target);
              if (target) {
                const dx = obj.transform.x - target.transform.x;
                const dy = obj.transform.y - target.transform.y;
                // The solver's `pendulum_from` places the bob at:
                //   px = pivot.x + L * sin(angleDeg)
                //   py = pivot.y + L * cos(angleDeg)
                // So: dx/L = sin(a), dy/L = cos(a)
                //     a    = atan2(dx, dy)
                // (NOT atan2(dx, -dy) — that would invert the Y axis
                // and produce a wrong angle. Verified: for a=0, bob is
                // directly below pivot, so dx=0, dy=L, atan2(0, L) = 0 ✓)
                const angleDeg = (Math.atan2(dx, dy) * 180) / Math.PI;
                if (Number.isFinite(angleDeg)) {
                  set((draft) => {
                    const o = draft.scene.objects.find((oo) => oo.id === id);
                    if (o) (o.params as Record<string, unknown>).angleDeg = angleDeg;
                  });
                }
              }
            }
          }
        }
      },

      /**
       * Like `setTransform` but also runs the solver + inference. Used by
       * the Inspector when the user edits a value directly — the change
       * should propagate to dependent objects.
       */
      setTransformAndSolve: (id, transform) => {
        get().setTransform(id, transform);
        get().solve();
      },

      /**
       * Apply a snap target on mouseup:
       *   1. Set the dragged object's transform to the snap position.
       *   2. Add the recommended relation to the dragged object.
       *   3. Re-run inference so the smart decorations activate.
       *   4. Re-run the solver so constraints are satisfied.
       *
       * For rope ends, the snap updates the rope's `from` / `to` param
       * rather than adding a relation.
       */
      applySnap: (candidate) => {
        pushHistory(`snap ${candidate.fromAttachId} → ${candidate.toAttachId}`);
        set((draft) => {
          const dragged = draft.scene.objects.find(
            (o) => o.id === candidate.draggedObjId
          );
          if (!dragged) return;
          // 1. Position
          dragged.transform.x = candidate.snapPosition.x;
          dragged.transform.y = candidate.snapPosition.y;
          // 2. Relation (or rope-end update)
          if (dragged.type === "rope") {
            // Rope: update `from` or `to` based on which end was dragged.
            // The relation stashed `ropeEnd` as a custom field.
            const ropeEnd = (candidate.relation as { ropeEnd?: string }).ropeEnd;
            if (ropeEnd === "from") dragged.params.from = candidate.targetObjId;
            else if (ropeEnd === "to") dragged.params.to = candidate.targetObjId;
          } else {
            // Other objects: append the relation (or replace if same kind).
            const rels = dragged.relations ?? [];
            const sameKind = rels.findIndex(
              (r) => r.kind === candidate.relation.kind
            );
            const newRel = candidate.relation;
            if (sameKind >= 0) rels[sameKind] = newRel;
            else rels.push(newRel);
            dragged.relations = rels;
          }
        });
        get().solve();
      },

      removeObject: (id) => {
        pushHistory("remove object");
        set((draft) => {
          draft.scene.objects = draft.scene.objects.filter((o) => o.id !== id);
          if (draft.selectedId === id) draft.selectedId = null;
          draft.selectedIds = draft.selectedIds.filter((sid) => sid !== id);
        });
      },

      select: (id) => {
        set((draft) => {
          draft.selectedId = id;
          draft.selectedIds = id ? [id] : [];
        });
      },

      toggleSelect: (id) => {
        set((draft) => {
          if (draft.selectedIds.includes(id)) {
            draft.selectedIds = draft.selectedIds.filter((s) => s !== id);
            if (draft.selectedId === id) {
              draft.selectedId = draft.selectedIds[0] ?? null;
            }
          } else {
            draft.selectedIds.push(id);
            draft.selectedId = id;
          }
        });
      },

      setSelection: (ids) => {
        set((draft) => {
          // de-dupe, preserve only ids that exist in the scene
          const valid = ids.filter((id) => draft.scene.objects.some((o) => o.id === id));
          draft.selectedIds = valid;
          draft.selectedId = valid[0] ?? null;
        });
      },

      setVisible: (id, visible) => {
        pushHistory(visible ? "show" : "hide");
        set((draft) => {
          const obj = draft.scene.objects.find((o) => o.id === id);
          if (!obj) return;
          obj.visible = visible;
        });
      },

      setCompositeVisible: (compositeOf, visible) => {
        pushHistory(visible ? "show composite" : "hide composite");
        set((draft) => {
          for (const obj of draft.scene.objects) {
            if (obj.compositeOf === compositeOf) obj.visible = visible;
          }
        });
      },

      setRoleVisible: (compositeOf, role, visible) => {
        pushHistory(visible ? `show ${role}` : `hide ${role}`);
        set((draft) => {
          for (const obj of draft.scene.objects) {
            if (obj.compositeOf === compositeOf && obj.compositeRole === role) {
              obj.visible = visible;
            }
          }
        });
      },

      // ── FBD state (not stored in scene; lives in the store only) ──
      fbdEnabled: {},
      fbdGlobalEnabled: {},

      setFbdVisible: (objectId, visible) => {
        set((draft) => {
          if (!draft.fbdEnabled[objectId]) draft.fbdEnabled[objectId] = {};
          // We use a special "_visible" key for the master toggle.
          draft.fbdEnabled[objectId]["_visible"] = visible;
        });
      },

      setFbdForceEnabled: (objectId, forceType, enabled) => {
        set((draft) => {
          if (!draft.fbdEnabled[objectId]) draft.fbdEnabled[objectId] = {};
          draft.fbdEnabled[objectId][forceType] = enabled;
        });
      },

      setFbdForceMagnitude: (objectId, forceType, magnitude) => {
        set((draft) => {
          if (!draft.fbdEnabled[objectId]) draft.fbdEnabled[objectId] = {};
          // Stash magnitude overrides alongside the enabled flag. Use a
          // namespaced key so it doesn't collide with the boolean toggles.
          draft.fbdEnabled[objectId][`_mag_${forceType}`] = magnitude;
        });
      },

      setFbdForceDirection: (objectId, forceType, directionDeg) => {
        set((draft) => {
          if (!draft.fbdEnabled[objectId]) draft.fbdEnabled[objectId] = {};
          draft.fbdEnabled[objectId][`_dir_${forceType}`] = directionDeg;
        });
      },

      setFbdGlobalEnabled: (forceType, enabled) => {
        set((draft) => {
          draft.fbdGlobalEnabled[forceType] = enabled;
        });
      },

      nudge: (ids, dx, dy) => {
        set((draft) => {
          for (const id of ids) {
            const obj = draft.scene.objects.find((o) => o.id === id);
            if (obj && !obj.locked) {
              obj.transform.x += dx;
              obj.transform.y += dy;
            }
          }
        });
        // don't push history every frame; the caller (drag handler) commits on mouseup
      },

      selectInRect: (rect) => {
        set((draft) => {
          const x1 = rect.x;
          const y1 = rect.y;
          const x2 = rect.x + rect.w;
          const y2 = rect.y + rect.h;
          const hits: string[] = [];
          for (const obj of draft.scene.objects) {
            const { x, y } = obj.transform;
            if (x >= x1 && x <= x2 && y >= y1 && y <= y2) hits.push(obj.id);
          }
          draft.selectedIds = hits;
          draft.selectedId = hits[0] ?? null;
        });
      },

      setViewport: (vp) => {
        set((draft) => {
          if (vp.x !== undefined) draft.viewport.x = vp.x;
          if (vp.y !== undefined) draft.viewport.y = vp.y;
          if (vp.zoom !== undefined) {
            // Clamp zoom to a reasonable range
            draft.viewport.zoom = Math.max(0.1, Math.min(8, vp.zoom));
          }
        });
      },

      resetViewport: () => {
        set((draft) => {
          draft.viewport = { x: 0, y: 0, zoom: 1.0 };
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

      commit: (label) => pushHistory(label ?? "commit"),

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
        // Step 1: constraint solver (positions, relations).
        // The solver writes back via a callback so Immer mutations are
        // detected (the scene passed in is frozen).
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

        // Step 2: role inference. The system recognizes known
        // configurations (pendulum, incline+block) and assigns
        // `compositeOf` + `compositeRole` to objects that don't have
        // them yet. This lets the user build a pendulum by hand and
        // have the smart decorations (T, mg, θ-arc) auto-activate.
        // Inference is idempotent — never overrides existing tags.
        const infScene = get().scene;
        const afterInf = inferRoles(infScene);
        // Write back the inferred scene.
        set((draft) => {
          draft.scene.objects = afterInf as SceneObject[];
        });

        // Step 3: derivation layer (the "smart" part). The constraint
        // solver gives us positions; the derivation layer gives us
        // derived visual properties (vector angles, block rotation,
        // θ-arc toAngle, etc.). It runs as a DAG so each node only
        // re-derives when one of its parents changed.
        //
        // We run in "conservative" mode here (re-derive everything) because
        // the solver just moved things around and we don't know which
        // parents changed. The smart mode is used elsewhere (e.g. after
        // a single param edit) where the caller knows exactly which
        // fields changed.
        //
        // Important: we run the recompute on a *copy* of the cache and
        // then write the result back through `set`. Mutating the store's
        // derived cache directly is illegal under Immer — it freezes the
        // state object so derivations can't write to it.
        const scene = get().scene;
        const derivations = buildSceneDerivations(scene);
        const nextDerived: DerivedCache = { ...get().derived };
        recomputeAll(derivations, scene, nextDerived, null);

        // Touch a known field so subscribers re-render, and write the
        // new derived cache.
        set((draft) => {
          draft.scene.meta.title = draft.scene.meta.title;
          // Replace the cache wholesale. Immer will accept the new
          // object since it's a fresh reference.
          for (const k of Object.keys(draft.derived)) delete draft.derived[k];
          Object.assign(draft.derived, nextDerived);
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