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

function polygonArea(outline: [number, number][]): number {
  let area = 0;
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    area += x0 * y1 - x1 * y0;
  }
  return area * 0.5;
}

export function mainplateOutline(radius: number): [number, number][] {
  const traced: [number, number][] = [
    [157, 26], [174, 20], [198, 21], [222, 25], [242, 37], [250, 46],
    [253, 71], [263, 82], [277, 98], [307, 96], [326, 99], [338, 108],
    [345, 126], [348, 147], [365, 176], [374, 209], [379, 246], [375, 278],
    [362, 310], [342, 333], [314, 351], [281, 362], [240, 370], [204, 372],
    [174, 368], [143, 359], [111, 345], [87, 328], [69, 307], [49, 277],
    [38, 245], [36, 210], [40, 176], [48, 144], [60, 113], [78, 87],
    [99, 64], [126, 43],
  ];
  const scale = Math.sqrt(Math.PI * radius * radius / Math.abs(polygonArea(traced)));
  return traced.map(([x, y]) => [(x - 208) * scale, (199 - y) * scale]);
}

export function alarmWheelPlateOutline(radius: number): [number, number][] {
  const traced: [number, number][] = [
    [544, 117], [580, 117], [615, 130], [648, 140], [680, 138], [712, 147],
    [743, 168], [770, 199], [788, 236], [793, 275], [784, 315], [762, 351],
    [728, 380], [690, 401], [648, 416], [610, 428], [575, 433], [540, 426],
    [507, 410], [480, 388], [459, 357], [445, 322], [438, 285], [439, 246],
    [449, 209], [469, 177], [493, 151], [521, 133],
  ];
  const scale = 0.82 * Math.sqrt(Math.PI * radius * radius / Math.abs(polygonArea(traced)));
  return traced.map(([x, y]) => [(x - 610) * scale, (260 - y) * scale]);
}

function triangulateProfile(outline: [number, number][]): number[] {
  const remaining = outline.map((_, i) => i);
  const triangles: number[] = [];
  const cross = (
    [ax, ay]: [number, number],
    [bx, by]: [number, number],
    [cx, cy]: [number, number],
  ) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const inside = (p: [number, number], a: [number, number], b: [number, number], c: [number, number]) => {
    const c0 = cross(a, b, p), c1 = cross(b, c, p), c2 = cross(c, a, p);
    return c0 >= -1e-8 && c1 >= -1e-8 && c2 >= -1e-8;
  };

  while (remaining.length > 3) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i++) {
      const ia = remaining[(i + remaining.length - 1) % remaining.length];
      const ib = remaining[i];
      const ic = remaining[(i + 1) % remaining.length];
      const a = outline[ia], b = outline[ib], c = outline[ic];
      if (cross(a, b, c) <= 1e-8) continue;
      if (remaining.some((index) => index !== ia && index !== ib && index !== ic && inside(outline[index], a, b, c))) continue;
      triangles.push(ia, ib, ic);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) throw new Error('Unable to triangulate plate profile');
  }
  triangles.push(remaining[0], remaining[1], remaining[2]);
  return triangles;
}

export function plateMesh(outline: [number, number][], z0: number, z1: number): MeshData {
  const points = polygonArea(outline) < 0 ? [...outline].reverse() : [...outline];
  const capTriangles = triangulateProfile(points);
  const n = points.length;
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % n];
    const length = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = (y1 - y0) / length, ny = -(x1 - x0) / length;
    const base = vertices.length / 6;
    vertices.push(x0, y0, z0, nx, ny, 0, x1, y1, z0, nx, ny, 0, x1, y1, z1, nx, ny, 0, x0, y0, z1, nx, ny, 0);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const top = vertices.length / 6;
  for (const [x, y] of points) vertices.push(x, y, z1, 0, 0, 1);
  for (let i = 0; i < capTriangles.length; i += 3) {
    indices.push(top + capTriangles[i], top + capTriangles[i + 1], top + capTriangles[i + 2]);
  }
  const bottom = vertices.length / 6;
  for (const [x, y] of points) vertices.push(x, y, z0, 0, 0, -1);
  for (let i = 0; i < capTriangles.length; i += 3) {
    indices.push(bottom + capTriangles[i + 2], bottom + capTriangles[i + 1], bottom + capTriangles[i]);
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}

function roundedOutline(outline: [number, number][], iterations: number): [number, number][] {
  let points = outline;
  for (let pass = 0; pass < iterations; pass++) {
    const rounded: [number, number][] = [];
    for (let i = 0; i < points.length; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[(i + 1) % points.length];
      rounded.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25]);
      rounded.push([x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    points = rounded;
  }
  return points;
}

export function roundedPlateMesh(outline: [number, number][], z0: number, z1: number, iterations = 2): MeshData {
  return plateMesh(roundedOutline(outline, iterations), z0, z1);
}

export interface PlateHole {
  x: number;
  y: number;
  radius: number;
}

export function perforatedPlateMesh(
  outline: [number, number][], holes: PlateHole[], z0: number, z1: number, iterations = 2,
): MeshData {
  const outer = roundedOutline(polygonArea(outline) < 0 ? [...outline].reverse() : outline, iterations);
  const holeOutlines = holes.map(({ x, y, radius }) => {
    const points: [number, number][] = [];
    for (let i = 0; i < 24; i++) {
      const angle = -(i / 24) * Math.PI * 2;
      points.push([x + Math.cos(angle) * radius, y + Math.sin(angle) * radius]);
    }
    return points;
  });
  const vertices: number[] = [];
  const indices: number[] = [];

  const addWalls = (points: [number, number][]) => {
    for (let i = 0; i < points.length; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[(i + 1) % points.length];
      const length = Math.hypot(x1 - x0, y1 - y0) || 1;
      const nx = (y1 - y0) / length, ny = -(x1 - x0) / length;
      const base = vertices.length / 6;
      vertices.push(x0, y0, z0, nx, ny, 0, x1, y1, z0, nx, ny, 0, x1, y1, z1, nx, ny, 0, x0, y0, z1, nx, ny, 0);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };
  addWalls(outer);
  for (const hole of holeOutlines) addWalls(hole);

  const crossings = (points: [number, number][], x: number): number[] => {
    const result: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[(i + 1) % points.length];
      if ((x < x0 && x < x1) || (x >= x0 && x >= x1) || x0 === x1) continue;
      result.push(y0 + ((x - x0) / (x1 - x0)) * (y1 - y0));
    }
    return result.sort((a, b) => a - b);
  };
  const materialIntervals = (x: number): [number, number][] => {
    const outerY = crossings(outer, x);
    const result: [number, number][] = [];
    for (let i = 0; i + 1 < outerY.length; i += 2) {
      let intervals: [number, number][] = [[outerY[i], outerY[i + 1]]];
      for (const hole of holeOutlines) {
        const holeY = crossings(hole, x);
        if (holeY.length < 2) continue;
        const cut: [number, number] = [holeY[0], holeY[holeY.length - 1]];
        const next: [number, number][] = [];
        for (const [a, b] of intervals) {
          if (cut[1] <= a || cut[0] >= b) next.push([a, b]);
          else {
            if (cut[0] > a) next.push([a, cut[0]]);
            if (cut[1] < b) next.push([cut[1], b]);
          }
        }
        intervals = next;
      }
      result.push(...intervals);
    }
    return result.sort((a, b) => a[0] - b[0]);
  };

  const eventX = [...outer, ...holeOutlines.flat()].map(([x]) => x).sort((a, b) => a - b);
  const uniqueX = eventX.filter((x, i) => i === 0 || Math.abs(x - eventX[i - 1]) > 1e-7);
  for (let i = 0; i + 1 < uniqueX.length; i++) {
    const inset = Math.min(1e-6, (uniqueX[i + 1] - uniqueX[i]) * 1e-5);
    const left = materialIntervals(uniqueX[i] + inset);
    const right = materialIntervals(uniqueX[i + 1] - inset);
    if (left.length !== right.length) throw new Error(`Unable to tessellate perforated plate at ${uniqueX[i]} (${outline[0][0]},${outline[0][1]}): ${left.length}/${right.length}`);
    for (let j = 0; j < left.length; j++) {
      const [low0, high0] = left[j];
      const [low1, high1] = right[j];
      if (high0 - low0 < 1e-7 || high1 - low1 < 1e-7) continue;
      const x0 = uniqueX[i] + inset, x1 = uniqueX[i + 1] - inset;
      let base = vertices.length / 6;
      vertices.push(x0, low0, z1, 0, 0, 1, x1, low1, z1, 0, 0, 1, x1, high1, z1, 0, 0, 1, x0, high0, z1, 0, 0, 1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      base = vertices.length / 6;
      vertices.push(x0, low0, z0, 0, 0, -1, x0, high0, z0, 0, 0, -1, x1, high1, z0, 0, 0, -1, x1, low1, z0, 0, 0, -1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
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

function mergeMeshes(parts: MeshData[]): MeshData {
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const part of parts) {
    const offset = vertices.length / 6;
    vertices.push(...part.vertices);
    for (const index of part.indices) indices.push(offset + index);
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}

function transformedMesh(data: MeshData, angle: number, x: number, y: number, z: number): MeshData {
  const vertices = new Float32Array(data.vertices);
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let i = 0; i < vertices.length; i += 6) {
    const px = vertices[i], py = vertices[i + 1];
    const nx = vertices[i + 3], ny = vertices[i + 4];
    vertices[i] = c * px - s * py + x;
    vertices[i + 1] = s * px + c * py + y;
    vertices[i + 2] += z;
    vertices[i + 3] = c * nx - s * ny;
    vertices[i + 4] = s * nx + c * ny;
  }
  return { vertices, indices: data.indices };
}

function toothedRingMesh(outline: [number, number][], innerRadius: number, z0: number, z1: number): MeshData {
  const n = outline.length;
  const inner = outline.map(([x, y]) => {
    const scale = innerRadius / Math.hypot(x, y);
    return [x * scale, y * scale] as [number, number];
  });
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [ox0, oy0] = outline[i], [ox1, oy1] = outline[j];
    const [ix0, iy0] = inner[i], [ix1, iy1] = inner[j];
    let base = vertices.length / 6;
    vertices.push(ox0, oy0, z1, 0, 0, 1, ox1, oy1, z1, 0, 0, 1, ix1, iy1, z1, 0, 0, 1, ix0, iy0, z1, 0, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    base = vertices.length / 6;
    vertices.push(ox0, oy0, z0, 0, 0, -1, ix0, iy0, z0, 0, 0, -1, ix1, iy1, z0, 0, 0, -1, ox1, oy1, z0, 0, 0, -1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    const length = Math.hypot(ox1 - ox0, oy1 - oy0) || 1;
    const nx = (oy1 - oy0) / length, ny = -(ox1 - ox0) / length;
    base = vertices.length / 6;
    vertices.push(ox0, oy0, z0, nx, ny, 0, ox1, oy1, z0, nx, ny, 0, ox1, oy1, z1, nx, ny, 0, ox0, oy0, z1, nx, ny, 0);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    base = vertices.length / 6;
    vertices.push(ix0, iy0, z0, -nx, -ny, 0, ix0, iy0, z1, -nx, -ny, 0, ix1, iy1, z1, -nx, -ny, 0, ix1, iy1, z0, -nx, -ny, 0);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}

export function ringMesh(outerRadius: number, innerRadius: number, z0: number, z1: number, segments = 48): MeshData {
  const outline: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    outline.push([Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius]);
  }
  return toothedRingMesh(outline, innerRadius, z0, z1);
}

export function flatBarMesh(
  x0: number, y0: number, x1: number, y1: number,
  width0: number, width1: number, z0: number, z1: number,
): MeshData {
  const length = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = -(y1 - y0) / length, ny = (x1 - x0) / length;
  return extrudeProfile([
    [x0 + nx * width0 / 2, y0 + ny * width0 / 2],
    [x1 + nx * width1 / 2, y1 + ny * width1 / 2],
    [x1 - nx * width1 / 2, y1 - ny * width1 / 2],
    [x0 - nx * width0 / 2, y0 - ny * width0 / 2],
  ], z0, z1);
}

/** Open five-spoke brass wheel used in the early all-metal going train. */
export function spokedGearMesh(
  teeth: number, pitchRadius: number, toothHeight: number,
  z0: number, z1: number, spokes = 5,
): MeshData {
  const outline = gearOutline(teeth, pitchRadius, toothHeight);
  const innerRadius = (pitchRadius - toothHeight * 0.55) * 0.82;
  const hubRadius = Math.max(1.1, pitchRadius * 0.16);
  const parts: MeshData[] = [
    toothedRingMesh(outline, innerRadius, z0, z1),
    disc(hubRadius, z0, z1, 24),
  ];
  const spokeLength = innerRadius - hubRadius + 0.8;
  for (let i = 0; i < spokes; i++) {
    const angle = (i / spokes) * Math.PI * 2;
    const middle = hubRadius + spokeLength / 2 - 0.4;
    parts.push(transformedMesh(
      box(Math.max(0.55, pitchRadius * 0.065), spokeLength, z1 - z0),
      angle - Math.PI / 2,
      Math.cos(angle) * middle,
      Math.sin(angle) * middle,
      (z0 + z1) / 2,
    ));
  }
  return mergeMeshes(parts);
}

/** Swiss lever escape-wheel outline with swept stems and broad club tips. */
export function escapeWheelOutline(teeth: number, radius: number): [number, number][] {
  const pts: [number, number][] = [];
  const step = (Math.PI * 2) / teeth;
  const polar = (r: number, a: number): [number, number] => [r * Math.cos(a), r * Math.sin(a)];
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    pts.push(polar(radius * 0.66, a));
    pts.push(polar(radius * 0.72, a + step * 0.18));
    pts.push(polar(radius * 0.91, a + step * 0.42));
    pts.push(polar(radius, a + step * 0.47));
    pts.push(polar(radius, a + step * 0.62));
    pts.push(polar(radius * 0.89, a + step * 0.65));
    pts.push(polar(radius * 0.74, a + step * 0.35));
    pts.push(polar(radius * 0.66, a + step * 0.58));
  }
  return pts;
}

export function escapeWheelMesh(teeth: number, radius: number, z0: number, z1: number): MeshData {
  const parts: MeshData[] = [
    toothedRingMesh(escapeWheelOutline(teeth, radius), radius * 0.6, z0, z1),
    disc(radius * 0.15, z0, z1, 28),
  ];
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const c = Math.cos(angle), s = Math.sin(angle);
    parts.push(flatBarMesh(
      c * radius * 0.1, s * radius * 0.1,
      c * radius * 0.64, s * radius * 0.64,
      radius * 0.075, radius * 0.055, z0, z1,
    ));
  }
  return mergeMeshes(parts);
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

// ---------- early all-metal Slava 5671 machined parts ----------

export function palletForkMesh(z0 = 3.0, z1 = 3.35): MeshData {
  return mergeMeshes([
    ringMesh(0.72, 0.26, z0, z1, 28),
    flatBarMesh(0, 0, -0.85, 0.95, 0.62, 0.48, z0, z1),
    flatBarMesh(-0.85, 0.95, -1.2, 2.3, 0.48, 0.36, z0, z1),
    flatBarMesh(-0.85, 0.95, -2.6, 0, 0.48, 0.36, z0, z1),
    flatBarMesh(0.15, -0.05, 3.75, -2.55, 0.58, 0.32, z0, z1),
    flatBarMesh(3.75, -2.55, 4.65, -2.1, 0.32, 0.22, z0, z1),
    flatBarMesh(3.75, -2.55, 4.65, -3.3, 0.32, 0.22, z0, z1),
  ]);
}

export function palletStonesMesh(z0 = 2.05, z1 = 3.45): MeshData {
  const stone = extrudeProfile([
    [-0.72, -0.28], [0.72, -0.28], [0.76, 0.22], [0.62, 0.34], [-0.72, 0.3],
  ], z0, z1);
  return mergeMeshes([
    transformedMesh(stone, -0.2284, -1.2, 2.3, 0),
    transformedMesh(stone, -0.8491, -2.6, 0, 0),
  ]);
}

export function alarmWheelOutline(teeth: number, radius: number): [number, number][] {
  return gearOutline(teeth, radius, 0.4).map(([x, y]) => {
    const angle = Math.atan2(y, x);
    const distance = Math.abs(Math.atan2(Math.sin(angle + Math.PI / 2), Math.cos(angle + Math.PI / 2)));
    if (distance > 0.075) return [x, y];
    const scale = (radius - 1.05) / Math.hypot(x, y);
    return [x * scale, y * scale];
  });
}

export function alarmStopSpringMesh(z0 = 5.85, z1 = 6.15): MeshData {
  return mergeMeshes([
    flatBarMesh(0, -5.0, 0.25, 5.8, 0.68, 0.55, z0, z1),
    flatBarMesh(0.25, 5.8, -0.35, 6.6, 0.55, 0.38, z0, z1),
    flatBarMesh(-0.35, 6.6, -0.85, 6.25, 0.38, 0.3, z0, z1),
    transformedMesh(box(0.38, 0.65, 0.85), 0, -0.85, 6.25, z0 - 0.425),
  ]);
}

export function alarmGuardMesh(z0 = 4.0, z1 = 4.35): MeshData {
  const outline: [number, number][] = [
    [1.0, 0.9], [2.3, 1.3], [3.0, 0.8], [3.1, -0.1], [2.2, -0.7],
    [0.8, -0.9], [-0.3, -2.0], [-1.0, -4.2], [-1.4, -6.1], [-2.0, -7.0],
    [-3.0, -7.2], [-3.7, -6.6], [-3.5, -5.7], [-2.7, -4.5], [-1.9, -2.4],
    [-1.2, -0.8], [-0.4, 0.5],
  ];
  return mergeMeshes([
    roundedPlateMesh(outline, z0, z1, 2),
    ringMesh(1.05, 0.36, z0, z1, 32),
    transformedMesh(box(0.38, 1.60, 3.40), 0, -2.7, -6.4, z0 + 1.70),
    transformedMesh(box(0.55, 0.70, 1.20), 0, -1.8, -5.0, z0 - 0.40),
  ]);
}

export function hammerForkMesh(z0 = 2.8, z1 = 3.35): MeshData {
  const outline: [number, number][] = [];
  for (let i = 0; i <= 20; i++) {
    const angle = (i / 20) * Math.PI;
    outline.push([Math.cos(angle) * 1.65, Math.sin(angle) * 1.65]);
  }
  for (let i = 20; i >= 0; i--) {
    const angle = (i / 20) * Math.PI;
    outline.push([Math.cos(angle) * 1.08, Math.sin(angle) * 1.08]);
  }
  return plateMesh(outline, z0, z1);
}

export function balanceCockMesh(z0 = 8.1, z1 = 8.65): MeshData {
  const outline: [number, number][] = [
    [-7.4, 3.7], [-7.2, 4.8], [-6.3, 5.35], [-5.25, 5.1], [-4.55, 4.15],
    [-3.75, 2.85], [-2.25, 1.85], [-1.25, 1.55], [0.05, 1.7], [1.25, 1.05],
    [1.75, -0.1], [1.85, -2.0], [2.45, -4.45], [2.6, -6.0], [2.05, -7.35],
    [1.0, -7.95], [-0.15, -7.65], [-0.75, -6.75], [-0.85, -5.35], [-0.45, -3.45],
    [-0.65, -1.85], [-1.45, -0.9], [-2.5, -0.15], [-3.85, 0.85], [-5.1, 1.75],
    [-6.25, 2.3], [-7.1, 2.75],
  ];
  return perforatedPlateMesh(outline, [
    { x: 0, y: 0, radius: 0.58 },
    { x: -6.2, y: 3.7, radius: 0.68 },
    { x: 1.0, y: -6.4, radius: 0.68 },
  ], z0, z1, 2);
}

// ---------- early all-metal Slava 5671 hands ----------

export function hourHandMesh(length = 18.0, z0 = 0, z1 = 0.22): MeshData {
  return mergeMeshes([
    ringMesh(1.75, 0.72, z0, z1, 40),
    extrudeProfile([
      [-0.55, 1.15], [0.55, 1.15], [0.46, length * 0.6],
      [0.38, length * 0.88], [-0.18, length], [-0.5, length * 0.9],
      [-0.46, length * 0.6],
    ], z0, z1),
  ]);
}

export function minuteHandMesh(length = 23.5, z0 = 0, z1 = 0.2): MeshData {
  return mergeMeshes([
    ringMesh(1.35, 0.46, z0, z1, 36),
    extrudeProfile([
      [-0.34, 0.9], [0.34, 0.9], [0.29, length * 0.6],
      [0.2, length * 0.9], [0, length], [-0.2, length * 0.9],
      [-0.29, length * 0.6],
    ], z0, z1),
  ]);
}

export function alarmHandMesh(length = 22.0, z0 = 0, z1 = 0.2): MeshData {
  return mergeMeshes([
    ringMesh(2.05, 0.7, z0, z1 + 0.65, 40),
    extrudeProfile([
      [-0.42, 1.5], [0.42, 1.5], [0.2, length * 0.62],
      [0, length], [-0.2, length * 0.62],
    ], z0, z1),
  ]);
}

