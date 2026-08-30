/**
 * meshes.ts — procedural geometry for cal. 5671 components.
 * All coordinates in millimetres, movement plane = XY, arbor axis = Z.
 * Vertex format: interleaved [px,py,pz, nx,ny,nz] (float32 × 6), indexed u32.
 */

export interface MeshData {
  vertices: Float32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
}

// ---------- profile extrusion (star-shaped profiles, fan caps) ----------

export function extrudeProfile(outline: [number, number][], z0: number, z1: number): MeshData {
  const n = outline.length;
  const verts: number[] = [];
  const idx: number[] = [];

  // side walls (quad per edge, proper normals)
  for (let i = 0; i < n; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % n];
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dy / len, ny = -dx / len; // outward (CCW outline)
    const base = verts.length / 6;
    verts.push(x0, y0, z0, nx, ny, 0, x1, y1, z0, nx, ny, 0, x1, y1, z1, nx, ny, 0, x0, y0, z1, nx, ny, 0);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // caps: fan about centroid (outline must be star-shaped w.r.t. centroid)
  let cx = 0, cy = 0;
  for (const [x, y] of outline) { cx += x; cy += y; }
  cx /= n; cy /= n;
  const cTop = verts.length / 6;
  verts.push(cx, cy, z1, 0, 0, 1);
  for (let i = 0; i < n; i++) verts.push(outline[i][0], outline[i][1], z1, 0, 0, 1);
  for (let i = 0; i < n; i++) idx.push(cTop, cTop + 1 + i, cTop + 1 + ((i + 1) % n));
  const cBot = verts.length / 6;
  verts.push(cx, cy, z0, 0, 0, -1);
  for (let i = 0; i < n; i++) verts.push(outline[i][0], outline[i][1], z0, 0, 0, -1);
  for (let i = 0; i < n; i++) idx.push(cBot, cBot + 1 + ((i + 1) % n), cBot + 1 + i);

  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

// ---------- gear outlines ----------

/** trapezoidal-tooth gear outline (brass train wheels) */
export function gearOutline(teeth: number, pitchRadius: number, toothHeight: number): [number, number][] {
  const pts: [number, number][] = [];
  const rRoot = pitchRadius - toothHeight * 0.55;
  const rTip = pitchRadius + toothHeight * 0.45;
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    // root gap 40%, tip land 25%, flanks
    pts.push([rRoot * Math.cos(a), rRoot * Math.sin(a)]);
    pts.push([rRoot * Math.cos(a + step * 0.18), rRoot * Math.sin(a + step * 0.18)]);
    pts.push([rTip * Math.cos(a + step * 0.32), rTip * Math.sin(a + step * 0.32)]);
    pts.push([rTip * Math.cos(a + step * 0.55), rTip * Math.sin(a + step * 0.55)]);
    pts.push([rRoot * Math.cos(a + step * 0.72), rRoot * Math.sin(a + step * 0.72)]);
  }
  return pts;
}

/** pinion outline (lantern-style rounded leaves) */
export function pinionOutline(leaves: number, radius: number): [number, number][] {
  return gearOutline(leaves, radius, radius * 0.45);
}

/** Swiss lever escape wheel: 15 club teeth with impulse plane (verified conventional form) */
export function escapeWheelOutline(teeth: number, radius: number): [number, number][] {
  const pts: [number, number][] = [];
  const rRoot = radius * 0.72;
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    pts.push([rRoot * Math.cos(a), rRoot * Math.sin(a)]);
    // long curved rise to the club
    pts.push([radius * 0.97 * Math.cos(a + step * 0.42), radius * 0.97 * Math.sin(a + step * 0.42)]);
    pts.push([radius * Math.cos(a + step * 0.52), radius * Math.sin(a + step * 0.52)]);
    // steep locking face back down
    pts.push([rRoot * Math.cos(a + step * 0.62), rRoot * Math.sin(a + step * 0.62)]);
  }
  return pts;
}

/** saw-tooth wheel of the alarm hammer fork (verified "like a circular saw") */
export function sawWheelOutline(teeth: number, radius: number): [number, number][] {
  const pts: [number, number][] = [];
  const rRoot = radius * 0.8;
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    pts.push([rRoot * Math.cos(a), rRoot * Math.sin(a)]);
    pts.push([radius * Math.cos(a + step * 0.75), radius * Math.sin(a + step * 0.75)]);
    pts.push([rRoot * Math.cos(a + step * 0.8), rRoot * Math.sin(a + step * 0.8)]);
  }
  return pts;
}

// ---------- lathe (surface of revolution) ----------

export function lathe(profile: [number, number][], segments: number): MeshData {
  const verts: number[] = [];
  const idx: number[] = [];
  const rows = profile.length;
  for (let j = 0; j < rows; j++) {
    const [r, z] = profile[j];
    // profile tangent → normal in (r,z) plane
    const [rP, zP] = profile[Math.max(0, j - 1)];
    const [rN, zN] = profile[Math.min(rows - 1, j + 1)];
    const tr = rN - rP, tz = zN - zP;
    const tl = Math.hypot(tr, tz) || 1;
    const nr = tz / tl, nz = -tr / tl;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      verts.push(r * c, r * s, z, nr * c, nr * s, nz);
    }
  }
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i;
      const b = a + segments + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

// ---------- box ----------

export function box(w: number, h: number, d: number): MeshData {
  const x = w / 2, y = h / 2, z = d / 2;
  const faces: [number[], [number, number, number]][] = [
    [[-x, -y, z, x, -y, z, x, y, z, -x, y, z], [0, 0, 1]],
    [[x, -y, -z, -x, -y, -z, -x, y, -z, x, y, -z], [0, 0, -1]],
    [[x, -y, z, x, -y, -z, x, y, -z, x, y, z], [1, 0, 0]],
    [[-x, -y, -z, -x, -y, z, -x, y, z, -x, y, -z], [-1, 0, 0]],
    [[-x, y, z, x, y, z, x, y, -z, -x, y, -z], [0, 1, 0]],
    [[-x, -y, -z, x, -y, -z, x, -y, z, -x, -y, z], [0, -1, 0]],
  ];
  const verts: number[] = [];
  const idx: number[] = [];
  for (const [pts, n] of faces) {
    const base = verts.length / 6;
    for (let i = 0; i < 4; i++) verts.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], n[0], n[1], n[2]);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

// ---------- disc (cylinder) ----------

export function disc(radius: number, z0: number, z1: number, segments = 48): MeshData {
  const outline: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    outline.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  return extrudeProfile(outline, z0, z1);
}

// ---------- hairspring ribbon (dynamic, rebuilt on CPU each frame) ----------

/**
 * Flat Archimedean spiral as a radial-width ribbon.
 * Breathing: each point at normalised length t twists about the staff by
 * twist·(1−t) — inner terminal pinned to the balance staff, outer terminal
 * pinned to the stud on the balance cock (verified flat, non-Breguet spring).
 */
export function hairspringVertices(
  turns: number, rInner: number, rOuter: number, width: number,
  segments: number, twist: number, z: number,
): Float32Array<ArrayBuffer> {
  const verts = new Float32Array(segments * 2 * 6);
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const phi = t * turns * Math.PI * 2;
    const r = rInner + (rOuter - rInner) * t;
    const breathe = twist * (1 - t);
    const a = phi + breathe;
    const c = Math.cos(a), s = Math.sin(a);
    // radial direction for ribbon width
    const rx = c, ry = s;
    const w = width / 2;
    const o = i * 12;
    verts[o + 0] = (r - w) * rx; verts[o + 1] = (r - w) * ry; verts[o + 2] = z;
    verts[o + 3] = 0; verts[o + 4] = 0; verts[o + 5] = 1;
    verts[o + 6] = (r + w) * rx; verts[o + 7] = (r + w) * ry; verts[o + 8] = z;
    verts[o + 9] = 0; verts[o + 10] = 0; verts[o + 11] = 1;
  }
  return verts;
}

export function hairspringIndices(segments: number): Uint32Array<ArrayBuffer> {
  const idx = new Uint32Array((segments - 1) * 6);
  for (let i = 0; i < segments - 1; i++) {
    const a = i * 2;
    idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
  }
  return idx;
}
