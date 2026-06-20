/**
 * Sample scenes — pre-built demo figures. Loadable from the toolbar dropdown.
 * These are also the JSON DSL examples that double as test cases and docs.
 */

import type { FigurateScene } from "./core/dsl";

export const PENDULUM_30DEG: FigurateScene = {
  version: "0.1.0",
  meta: { title: "Pendulum at 30°", subject: "physics:mechanics" },
  canvas: { width: 900, height: 600, background: "#fafafa", grid: { enabled: true, spacing: 20, color: "#e8e8e8" } },
  objects: [
    {
      id: "pivot1",
      type: "pendulum_pivot",
      params: { barWidth: 80, hatchSpacing: 8 },
      transform: { x: 450, y: 100 },
      zIndex: 0,
    },
    {
      id: "bob1",
      type: "pendulum_bob",
      params: { radius: 22, angleDeg: 30, ropeLength: 200, mass: 1, fill: "#fff" },
      transform: { x: 0, y: 0 }, // solved by solver
      relations: [{ kind: "pendulum_from", target: "pivot1" }],
      zIndex: 2,
    },
    {
      id: "rope1",
      type: "rope",
      params: { from: "pivot1", to: "bob1", color: "#444", thickness: 1.5 },
      transform: { x: 0, y: 0 },
      zIndex: 1,
    },
    {
      id: "theta_arc",
      type: "angle_marker",
      params: { vertexX: 450, vertexY: 100, fromAngleDeg: 0, toAngleDeg: 30, radius: 50, label: "θ", color: "#1f6feb" },
      transform: { x: 450, y: 100 },
      zIndex: 3,
    },
    {
      id: "tension",
      type: "vector",
      params: { magnitude: 80, angleDeg: 120, color: "#1f6feb", thickness: 2, label: "T" },
      transform: { x: 0, y: 0 }, // attached to bob
      relations: [{ kind: "origin_at", target: "bob1", anchor: "center" }],
      zIndex: 4,
    },
    {
      id: "weight",
      type: "vector",
      params: { magnitude: 90, angleDeg: -90, color: "#c0392b", thickness: 2, label: "mg" },
      transform: { x: 0, y: 0 },
      relations: [{ kind: "origin_at", target: "bob1", anchor: "center" }],
      zIndex: 4,
    },
  ],
};

export const BLOCK_ON_INCLINE: FigurateScene = {
  version: "0.1.0",
  meta: { title: "Block on a 25° incline", subject: "physics:mechanics" },
  canvas: { width: 900, height: 600, background: "#fafafa", grid: { enabled: true, spacing: 20, color: "#e8e8e8" } },
  objects: [
    {
      id: "incline1",
      type: "incline",
      params: { length: 280, angleDeg: 25, thickness: 4, hatching: true },
      transform: { x: 250, y: 450 },
      zIndex: 0,
    },
    {
      id: "block1",
      type: "block",
      params: { width: 70, height: 45, fill: "#fff", mass: 2 },
      transform: { x: 0, y: 0 },
      relations: [{ kind: "rests_on", target: "incline1", fraction: 0.55 }],
      zIndex: 2,
    },
    {
      id: "f_gravity",
      type: "vector",
      params: { magnitude: 100, angleDeg: -90, color: "#c0392b", thickness: 2.5, label: "mg" },
      transform: { x: 0, y: 0 },
      relations: [{ kind: "origin_at", target: "block1", anchor: "center" }],
      zIndex: 4,
    },
    {
      id: "f_normal",
      type: "vector",
      params: { magnitude: 90, angleDeg: 65, color: "#1f6feb", thickness: 2.5, label: "N" },
      transform: { x: 0, y: 0 },
      relations: [{ kind: "origin_at", target: "block1", anchor: "center" }],
      zIndex: 4,
    },
    {
      id: "f_friction",
      type: "vector",
      params: { magnitude: 42, angleDeg: 205, color: "#e67e22", thickness: 2.5, label: "f" },
      transform: { x: 0, y: 0 },
      relations: [{ kind: "origin_at", target: "block1", anchor: "center" }],
      zIndex: 4,
    },
    {
      id: "theta_arc",
      type: "angle_marker",
      params: { vertexX: 250, vertexY: 450, fromAngleDeg: 0, toAngleDeg: 25, radius: 50, label: "25°", color: "#1f6feb" },
      transform: { x: 250, y: 450 },
      zIndex: 3,
    },
  ],
};

export const FREE_BODY: FigurateScene = {
  version: "0.1.0",
  meta: { title: "Free-body diagram", subject: "physics:mechanics" },
  canvas: { width: 900, height: 600, background: "#fafafa", grid: { enabled: true, spacing: 20, color: "#e8e8e8" } },
  objects: [
    {
      id: "mass",
      type: "pendulum_bob",
      params: { radius: 28, angleDeg: 0, ropeLength: 0, mass: 5, fill: "#fff" },
      transform: { x: 450, y: 300 },
      zIndex: 0,
    },
    {
      id: "f_gravity",
      type: "vector",
      params: { magnitude: 120, angleDeg: -90, color: "#c0392b", thickness: 2.5, label: "mg" },
      transform: { x: 0, y: 0 },
      relations: [{ kind: "origin_at", target: "mass", anchor: "center" }],
      zIndex: 4,
    },
    {
      id: "f_normal",
      type: "vector",
      params: { magnitude: 120, angleDeg: 90, color: "#1f6feb", thickness: 2.5, label: "N" },
      transform: { x: 0, y: 0 },
      relations: [{ kind: "origin_at", target: "mass", anchor: "center" }],
      zIndex: 4,
    },
    {
      id: "f_applied",
      type: "vector",
      params: { magnitude: 100, angleDeg: 30, color: "#27ae60", thickness: 2.5, label: "F" },
      transform: { x: 0, y: 0 },
      relations: [{ kind: "origin_at", target: "mass", anchor: "center" }],
      zIndex: 4,
    },
  ],
};

export const SAMPLE_SCENES: Record<string, { label: string; scene: FigurateScene }> = {
  pendulum: { label: "Pendulum at 30°", scene: PENDULUM_30DEG },
  incline: { label: "Block on 25° incline", scene: BLOCK_ON_INCLINE },
  freebody: { label: "Free-body diagram", scene: FREE_BODY },
};