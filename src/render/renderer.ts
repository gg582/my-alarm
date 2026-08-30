/**
 * Slava5671Renderer — WebGPU forward renderer for the cal. 5671 movement.
 *
 * · Procedural meshes (see meshes.ts): mainplate, openwork bridges, gear train
 *   (brass wheels / steel pinions), 15-tooth club-tooth escape wheel, pallet fork with
 *   ruby pallets, screwless balance with staff & double roller, ruby impulse jewel,
 *   flat hairspring rebuilt every frame with Archimedean breathing, hour/alarm wheel
 *   release assembly with axial drop, alarm barrel, saw-tooth hammer-fork wheel,
 *   hammer, and the stamped-steel bell (lathe).
 * · PBR: metallic-workflow Cook–Torrance (GGX/Smith/Schlick), two key lights +
 *   hemispherical ambient + environment sheen. Materials differentiate brushed brass,
 *   polished & blued steel, glossy synthetic ruby and stamped bell steel.
 */

import {
  extrudeProfile, gearOutline, pinionOutline, escapeWheelOutline,
  sawWheelOutline, lathe, box, disc, hairspringVertices, hairspringIndices,
  hourHandMesh, minuteHandMesh, secondHandMesh, alarmHandMesh, dialRingMesh,
} from './meshes';
import type { MeshData } from './meshes';
import type { SimSnapshot, SimEvent } from '../sim/physics';
import { SPEC } from '../sim/specs';

// ---------------- minimal mat4 ----------------
type Mat4 = Float32Array;
function m4identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}
function m4mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function m4translate(x: number, y: number, z: number): Mat4 {
  const m = m4identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}
function m4rotZ(a: number): Mat4 {
  const m = m4identity();
  const c = Math.cos(a), s = Math.sin(a);
  m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
  return m;
}
function m4perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = far / (near - far); m[11] = -1;
  m[14] = (far * near) / (near - far);
  return m;
}
function m4lookAt(eye: number[], target: number[], up: number[] = [0, 0, 1]): Mat4 {
  const z = norm3(sub3(eye, target));
  let upVec = up;
  if (Math.abs(dot3(z, upVec)) > 0.95) {
    upVec = [0, 1, 0];
  }
  const x = norm3(cross3(upVec, z));
  const y = cross3(z, x);
  const m = m4identity();
  m[0] = x[0]; m[1] = y[0]; m[2] = z[0];
  m[4] = x[1]; m[5] = y[1]; m[6] = z[1];
  m[8] = x[2]; m[9] = y[2]; m[10] = z[2];
  m[12] = -dot3(x, eye); m[13] = -dot3(y, eye); m[14] = -dot3(z, eye);
  return m;
}
const sub3 = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ---------------- WGSL ----------------

const SHADER = /* wgsl */ `
struct Frame {
  viewProj : mat4x4<f32>,
  camPos   : vec3<f32>,
  l1dir    : vec3<f32>,
  l1col    : vec3<f32>,
  l2dir    : vec3<f32>,
  l2col    : vec3<f32>,
  ambSky   : vec3<f32>,
  ambGnd   : vec3<f32>,
};
@group(0) @binding(0) var<uniform> frame : Frame;

struct Obj {
  model     : mat4x4<f32>,
  baseColor : vec3<f32>,
  metallic  : f32,
  roughness : f32,
  flags     : f32,
  pad0      : f32,
  emissive  : vec3<f32>,
  pad1      : vec3<f32>,
};
@group(1) @binding(0) var<uniform> obj : Obj;

struct VOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) world : vec3<f32>,
  @location(1) normal : vec3<f32>,
};

@vertex
fn vs(@location(0) p : vec3<f32>, @location(1) n : vec3<f32>) -> VOut {
  var o : VOut;
  let wp = obj.model * vec4<f32>(p, 1.0);
  o.pos = frame.viewProj * wp;
  o.world = wp.xyz;
  o.normal = (obj.model * vec4<f32>(n, 0.0)).xyz;
  return o;
}

fn D_GGX(NoH : f32, rough : f32) -> f32 {
  let a = rough * rough;
  let a2 = a * a;
  let d = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / (3.14159 * d * d);
}
fn G_Smith(NoV : f32, NoL : f32, rough : f32) -> f32 {
  let k = (rough + 1.0) * (rough + 1.0) / 8.0;
  return (NoV / (NoV * (1.0 - k) + k)) * (NoL / (NoL * (1.0 - k) + k));
}
fn fresnel(VoH : f32, F0 : vec3<f32>) -> vec3<f32> {
  return F0 + (vec3<f32>(1.0) - F0) * pow(clamp(1.0 - VoH, 0.0, 1.0), 5.0);
}

fn shade(N : vec3<f32>, V : vec3<f32>, L : vec3<f32>, Lc : vec3<f32>,
         albedo : vec3<f32>, metallic : f32, rough : f32) -> vec3<f32> {
  let H = normalize(V + L);
  let NoL = max(dot(N, L), 0.0);
  if (NoL <= 0.0) { return vec3<f32>(0.0); }
  let NoV = max(dot(N, V), 1e-4);
  let NoH = max(dot(N, H), 0.0);
  let VoH = max(dot(V, H), 0.0);
  let F0 = mix(vec3<f32>(0.04), albedo, metallic);
  let F = fresnel(VoH, F0);
  let spec = D_GGX(NoH, rough) * G_Smith(NoV, NoL, rough) * F / (4.0 * NoV * NoL);
  let diff = (vec3<f32>(1.0) - F) * (1.0 - metallic) * albedo / 3.14159;
  return (diff + spec) * Lc * NoL;
}

@fragment
fn fs(v : VOut) -> @location(0) vec4<f32> {
  var N = normalize(v.normal);
  let V = normalize(frame.camPos - v.world);
  if (dot(N, V) < 0.0) { N = -N; } // double-sided (hairspring ribbon, bell interior)
  let albedo = obj.baseColor;
  let rough = clamp(obj.roughness, 0.05, 1.0);

  var col = shade(N, V, normalize(-frame.l1dir), frame.l1col, albedo, obj.metallic, rough);
  col += shade(N, V, normalize(-frame.l2dir), frame.l2col, albedo, obj.metallic, rough);

  // hemispherical ambient
  let amb = mix(frame.ambGnd, frame.ambSky, N.z * 0.5 + 0.5);
  col += amb * albedo * mix(0.25, 1.0, 1.0 - obj.metallic * 0.6);

  // environment sheen for polished metal / ruby
  let R = reflect(-V, N);
  let envSpec = pow(max(dot(R, normalize(-frame.l1dir)), 0.0), 24.0 / rough);
  let F0 = mix(vec3<f32>(0.04), albedo, obj.metallic);
  col += envSpec * F0 * frame.l1col * 0.35;

  col += obj.emissive;

  // tonemap + gamma
  col = col / (col + vec3<f32>(1.0));
  col = pow(col, vec3<f32>(1.0 / 2.2));
  return vec4<f32>(col, 1.0);
}
`;

// ---------------- materials ----------------

interface Material {
  color: [number, number, number];
  metallic: number;
  roughness: number;
}

const MAT = {
  brassPlate: { color: [0.55, 0.42, 0.18], metallic: 1, roughness: 0.42 } as Material,
  brass: { color: [0.72, 0.55, 0.24], metallic: 1, roughness: 0.3 } as Material,
  brassBright: { color: [0.8, 0.62, 0.28], metallic: 1, roughness: 0.16 } as Material,
  steel: { color: [0.72, 0.74, 0.78], metallic: 1, roughness: 0.14 } as Material,
  steelSatin: { color: [0.6, 0.62, 0.66], metallic: 1, roughness: 0.35 } as Material,
  blued: { color: [0.1, 0.18, 0.5], metallic: 1, roughness: 0.2 } as Material,
  ruby: { color: [0.55, 0.015, 0.05], metallic: 0.15, roughness: 0.06 } as Material,
  bell: { color: [0.78, 0.8, 0.84], metallic: 1, roughness: 0.22 } as Material,
  dark: { color: [0.16, 0.16, 0.18], metallic: 0.9, roughness: 0.5 } as Material,
  red: { color: [0.88, 0.12, 0.18], metallic: 0.85, roughness: 0.25 } as Material,
  cyan: { color: [0.06, 0.58, 0.88], metallic: 0.9, roughness: 0.22 } as Material,
  gold: { color: [0.88, 0.72, 0.25], metallic: 0.95, roughness: 0.18 } as Material,
  dialSilver: { color: [0.84, 0.86, 0.89], metallic: 0.5, roughness: 0.4 } as Material,
};

// ---------------- scene objects ----------------

interface GpuMesh {
  vbuf: GPUBuffer;
  ibuf: GPUBuffer;
  count: number;
}

interface SceneObject {
  mesh: GpuMesh;
  bind: GPUBindGroup;
  ubuf: GPUBuffer;
  pivot: [number, number, number];
  local: [number, number, number];
  mat: Material;
  /** returns [spinAngle, extraZ] for the current snapshot */
  anim: (s: SimSnapshot) => [number, number];
  emissive: [number, number, number];
}

const HAIRSPRING_SEGMENTS = 260;

export class Slava5671Renderer {
  private device!: GPUDevice;
  private ctx!: GPUCanvasContext;
  private pipeline!: GPURenderPipeline;
  private frameUBO!: GPUBuffer;
  private frameBind!: GPUBindGroup;
  private objLayout!: GPUBindGroupLayout;
  private depthTex!: GPUTexture;
  private objects: SceneObject[] = [];
  private canvas: HTMLCanvasElement;

  // hairspring dynamic mesh
  private hsVBuf!: GPUBuffer;
  private hsIBuf!: GPUBuffer;
  private hsCount = 0;
  private hsObject!: SceneObject;

  // camera
  private yaw = 0.35;
  private pitch = 0.62;
  private dist = 105;
  private target = [0, 0, -1];

  private bellFlash = 0;
  ok = false;
  error: string | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.attachCameraControls();
  }

  async init(): Promise<boolean> {
    if (!navigator.gpu) {
      this.error = 'WebGPU is not available in this browser. Use Chrome/Edge 113+.';
      return false;
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      this.error = 'No WebGPU adapter found.';
      return false;
    }
    this.device = await adapter.requestDevice();
    const context = this.canvas.getContext('webgpu');
    if (!context) {
      this.error = 'Could not acquire WebGPU canvas context.';
      return false;
    }
    this.ctx = context;
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: this.device, format, alphaMode: 'opaque' });

    // frame UBO + bind group
    this.frameUBO = this.device.createBuffer({ size: 176, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const frameLayout = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });
    const objLayout = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });
    this.frameBind = this.device.createBindGroup({
      layout: frameLayout,
      entries: [{ binding: 0, resource: { buffer: this.frameUBO } }],
    });
    this.objLayout = objLayout;

    const module = this.device.createShaderModule({ code: SHADER });
    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [frameLayout, objLayout] }),
      vertex: {
        module,
        entryPoint: 'vs',
        buffers: [{
          arrayStride: 24,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
          ],
        }],
      },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    this.buildScene();
    this.resize();
    this.ok = true;
    return true;
  }

  private uploadMesh(data: MeshData): GpuMesh {
    const vbuf = this.device.createBuffer({ size: data.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(vbuf, 0, data.vertices);
    const ibuf = this.device.createBuffer({ size: data.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(ibuf, 0, data.indices);
    return { vbuf, ibuf, count: data.indices.length };
  }

  private addObject(
    data: MeshData, mat: Material,
    pivot: [number, number, number],
    anim: (s: SimSnapshot) => [number, number] = () => [0, 0],
    local: [number, number, number] = [0, 0, 0],
  ): SceneObject {
    const mesh = this.uploadMesh(data);
    const ubuf = this.device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bind = this.device.createBindGroup({ layout: this.objLayout, entries: [{ binding: 0, resource: { buffer: ubuf } }] });
    const obj: SceneObject = { mesh, bind, ubuf, pivot, local, mat, anim, emissive: [0, 0, 0] };
    this.objects.push(obj);
    return obj;
  }

  private buildScene() {
    const t = SPEC.train;

    // ---------- stamped steel bell (back cover, verified крышка-звонок) ----------
    const bellProfile: [number, number][] = [
      [0, -13.5], [20, -13.5], [27, -13.2], [30.5, -11.5], [32, -8.5], [32.2, -5], [31.4, -4.6],
      [31.2, -8.2], [29.8, -11], [26.5, -12.6], [20, -12.9], [0, -12.9],
    ];
    const bell = this.addObject(lathe(bellProfile, 96), MAT.bell, [0, 0, 0]);
    bell.emissive = [0, 0, 0];

    // ---------- mainplate (56 mm caliber) ----------
    this.addObject(disc(SPEC.mainplateRadius, -1.2, 1.2, 96), MAT.brassPlate, [0, 0, 0]);

    // ---------- gear positions (wheel-pinion centre distances from pitch radii) ----------
    const POS = {
      barrel: [-11, -11] as const,
      center: [16.6, 10.3] as const,
      third: [4.5, 16.5] as const,
      fourth: [-5.5, 12.5] as const,
      escape: [-10.5, 7] as const,
      fork: [-13.4, 13.4] as const,
      balance: [-13.4, 21.6] as const,
      alarmBarrel: [13, -14] as const,
      saw: [1.5, -20.5] as const,
      hammer: [-17.5, -16.5] as const,
    };

    // ---------- time barrel (brass, verified) ----------
    this.addObject(extrudeProfile(gearOutline(t.barrel.wheelTeeth, 17, 1.6), 0.4, 3.4), MAT.brass, [POS.barrel[0], POS.barrel[1], 0],
      (s) => [s.barrelAngle, 0]);
    this.addObject(disc(3.2, 3.4, 4.6), MAT.steelSatin, [POS.barrel[0], POS.barrel[1], 0], (s) => [s.barrelAngle * 4, 0]); // ratchet wheel

    // ---------- center wheel + minute pinion ----------
    this.addObject(extrudeProfile(gearOutline(t.center.wheelTeeth, 12, 1.2), 0.4, 2.6), MAT.brass, [POS.center[0], POS.center[1], 0],
      (s) => [s.centerAngle, 0]);
    this.addObject(extrudeProfile(pinionOutline(t.center.pinion, 2.6), 2.6, 4.4), MAT.steel, [POS.center[0], POS.center[1], 0],
      (s) => [s.centerAngle, 0]);

    // ---------- third wheel ----------
    this.addObject(extrudeProfile(gearOutline(t.third.wheelTeeth, 8.5, 1.0), 0.4, 2.2), MAT.brass, [POS.third[0], POS.third[1], 0],
      (s) => [s.thirdAngle, 0]);
    this.addObject(extrudeProfile(pinionOutline(t.third.pinion, 1.5), 2.2, 3.8), MAT.steel, [POS.third[0], POS.third[1], 0],
      (s) => [s.thirdAngle, 0]);

    // ---------- fourth wheel ----------
    this.addObject(extrudeProfile(gearOutline(t.fourth.wheelTeeth, 6, 0.9), 0.4, 2.0), MAT.brass, [POS.fourth[0], POS.fourth[1], 0],
      (s) => [s.fourthAngle, 0]);
    this.addObject(extrudeProfile(pinionOutline(t.fourth.pinion, 1.8), 2.0, 3.6), MAT.steel, [POS.fourth[0], POS.fourth[1], 0],
      (s) => [s.fourthAngle, 0]);

    // ---------- escape wheel: 15 club teeth, steel, jewelled pivots ----------
    this.addObject(extrudeProfile(escapeWheelOutline(SPEC.escapeWheelTeeth, 5.2), 2.2, 3.0), MAT.steel, [POS.escape[0], POS.escape[1], 0],
      (s) => [s.escapeAngle, 0]);
    this.addObject(extrudeProfile(pinionOutline(t.escape.pinion, 1.4), 1.4, 3.4), MAT.steel, [POS.escape[0], POS.escape[1], 0],
      (s) => [s.escapeAngle, 0]);

    // ---------- pallet fork with ruby pallets (verified: 2 pallet jewels) ----------
    const forkP: [number, number, number] = [POS.fork[0], POS.fork[1], 0];
    const forkAnim = (s: SimSnapshot): [number, number] => [s.forkAngle, 0];
    // fork body: arm toward escape wheel
    this.addObject(box(2.2, 7.5, 1.2), MAT.steel, forkP, forkAnim, [0.4, -3.4, 3.4]);
    // entry & exit pallet stones (synthetic ruby)
    this.addObject(box(1.1, 2.4, 1.5), MAT.ruby, forkP, forkAnim, [-1.1, -6.2, 3.2]);
    this.addObject(box(1.1, 2.4, 1.5), MAT.ruby, forkP, forkAnim, [2.0, -5.6, 3.2]);
    // fork horns toward the balance roller + guard pin
    this.addObject(box(1.6, 4.2, 1.0), MAT.steel, forkP, forkAnim, [0, 3.4, 3.4]);
    this.addObject(disc(0.28, 3.0, 4.6, 12), MAT.steel, forkP, forkAnim, [0, 5.2, 0]);

    // ---------- screwless balance (verified безвинтовый), heavy rim ----------
    const balP: [number, number, number] = [POS.balance[0], POS.balance[1], 0];
    const balAnim = (s: SimSnapshot): [number, number] => [s.balanceAngle, 0];
    // rim: lathe ring
    const rimProfile: [number, number][] = [[6.4, 5.4], [7.4, 5.4], [7.6, 6.0], [7.4, 6.6], [6.4, 6.6], [6.2, 6.0], [6.4, 5.4]];
    this.addObject(lathe(rimProfile, 72), MAT.brassBright, balP, balAnim);
    // two crossing arms
    this.addObject(box(13.2, 1.3, 0.9), MAT.brassBright, balP, balAnim, [0, 0, 6.0]);
    this.addObject(box(1.3, 13.2, 0.9), MAT.brassBright, balP, balAnim, [0, 0, 6.0]);
    // staff
    this.addObject(disc(0.5, 3.2, 9.6, 16), MAT.steel, balP, balAnim);
    // double roller + ruby impulse jewel (ellipse)
    this.addObject(disc(1.7, 4.2, 5.2, 24), MAT.steelSatin, balP, balAnim);
    this.addObject(disc(0.38, 4.0, 5.4, 10), MAT.ruby, balP, balAnim, [1.35, 0, 0]);

    // ---------- hairspring (dynamic, Archimedean breathing) ----------
    this.hsVBuf = this.device.createBuffer({
      size: HAIRSPRING_SEGMENTS * 2 * 24,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const hsIdx = hairspringIndices(HAIRSPRING_SEGMENTS);
    this.hsIBuf = this.device.createBuffer({ size: hsIdx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.hsIBuf, 0, hsIdx);
    this.hsCount = hsIdx.length;
    const hsMesh: GpuMesh = { vbuf: this.hsVBuf, ibuf: this.hsIBuf, count: this.hsCount };
    const hsUbuf = this.device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const hsBind = this.device.createBindGroup({ layout: this.objLayout, entries: [{ binding: 0, resource: { buffer: hsUbuf } }] });
    this.hsObject = {
      mesh: hsMesh, bind: hsBind, ubuf: hsUbuf,
      pivot: balP, local: [0, 0, 0], mat: MAT.blued, anim: () => [0, 0], emissive: [0, 0, 0],
    };
    this.objects.push(this.hsObject);
    // hairspring stud on the cock (fixed)
    this.addObject(box(0.9, 0.9, 1.6), MAT.brass, balP, () => [0, 0], [5.05, 1.4, 7.6]);

    // ---------- balance cock (skeleton arm) + ruby endstone ----------
    this.addObject(box(3.4, 12.5, 1.4), MAT.brassPlate, [POS.balance[0], 14.8, 0], () => [0, 0], [0, 0, 8.6]);
    this.addObject(disc(1.1, 8.2, 8.8, 20), MAT.ruby, balP);
    this.addObject(disc(1.5, 8.6, 9.4, 20), MAT.steelSatin, [POS.balance[0], 9.2, 0]);

    // ---------- openwork train bridge arms over the 5 arbors ----------
    const bridgeZ = 5.2;
    this.addObject(box(3.0, 24, 1.2), MAT.brassPlate, [POS.barrel[0], POS.barrel[1], 0], () => [Math.atan2(POS.center[1] - POS.barrel[1], POS.center[0] - POS.barrel[0]) + Math.PI / 2, 0],
      [0, -(12), bridgeZ]);
    this.addObject(box(2.4, 16, 1.0), MAT.brassPlate, [POS.center[0], POS.center[1], 0], () => [Math.atan2(POS.escape[1] - POS.center[1], POS.escape[0] - POS.center[0]) + Math.PI / 2, 0],
      [0, -7, bridgeZ]);
    // pivot jewels in the train (brass bushings — train unjewelled, verified) rendered as bushings
    for (const p of [POS.barrel, POS.center, POS.third, POS.fourth]) {
      this.addObject(disc(1.0, bridgeZ + 0.5, bridgeZ + 1.1, 16), MAT.brassBright, [p[0], p[1], 0]);
    }
    // escape & fork arbors run in jewels (verified)
    this.addObject(disc(0.9, 4.6, 5.2, 16), MAT.ruby, [POS.escape[0], POS.escape[1], 0]);
    this.addObject(disc(0.9, 4.6, 5.2, 16), MAT.ruby, forkP);

    // ---------- hour wheel + alarm wheel release assembly (exposition, dial side) ----------
    // hour wheel with lug (усик), axial spring tension; drops into alarm wheel slot
    const hourAnim = (s: SimSnapshot): [number, number] => [s.hourHandAngle, -s.hourWheelDrop * SPEC.hourWheelAxialDrop];
    this.addObject(disc(8.6, 3.4, 4.4, 48), MAT.steelSatin, [POS.center[0], POS.center[1], 0], hourAnim);
    this.addObject(box(1.2, 1.2, 1.6), MAT.steel, [POS.center[0], POS.center[1], 0], hourAnim, [0, -7.6, 1.2]); // the lug
    // alarm wheel with the slot (паз) — rotates with the central alarm hand
    const alarmAnim = (s: SimSnapshot): [number, number] => [s.alarmHandAngle, 0];
    this.addObject(disc(7.2, 4.8, 5.6, 48), MAT.brass, [POS.center[0], POS.center[1], 0], alarmAnim);
    this.addObject(box(1.4, 1.4, 1.2), MAT.dark, [POS.center[0], POS.center[1], 0], alarmAnim, [0, -6.4, 1.6]); // slot marker
    // cannon pinion + minute wheel (motion works, 12:1 verified)
    this.addObject(extrudeProfile(pinionOutline(SPEC.motionWorks.cannonPinionTeeth, 1.6), 5.6, 7.4), MAT.steel, [POS.center[0], POS.center[1], 0],
      (s) => [s.minuteHandAngle, 0]);

    // ---------- alarm barrel (brass, slipping bridle) ----------
    this.addObject(extrudeProfile(gearOutline(SPEC.alarmBarrel.wheelTeeth, 11.5, 1.3), 0.4, 3.0), MAT.brass, [POS.alarmBarrel[0], POS.alarmBarrel[1], 0],
      (s) => [s.alarmWheelAngle / (SPEC.alarmBarrel.wheelTeeth / SPEC.alarmBarrel.pinion), 0]);
    this.addObject(disc(2.6, 3.0, 4.2), MAT.steelSatin, [POS.alarmBarrel[0], POS.alarmBarrel[1], 0]);

    // ---------- hammer-fork saw wheel (verified saw-tooth) ----------
    this.addObject(extrudeProfile(sawWheelOutline(SPEC.hammerForkWheelTeeth, 4.6), 2.4, 3.2), MAT.steel, [POS.saw[0], POS.saw[1], 0],
      (s) => [s.alarmWheelAngle, 0]);

    // ---------- hammer: fork + axle + bracket + head (verified construction) ----------
    const hamP: [number, number, number] = [POS.hammer[0], POS.hammer[1], 0];
    const hamAnim = (s: SimSnapshot): [number, number] => [-s.hammerAngle * 0.9, 0];
    this.addObject(box(1.4, 15.5, 1.1), MAT.steel, hamP, hamAnim, [0, 8.2, 3.6]); // arm toward bell wall
    const headProfile: [number, number][] = [[0, 2.6], [1.6, 2.8], [2.0, 3.6], [2.0, 4.6], [1.6, 5.2], [0, 5.3]];
    this.addObject(lathe(headProfile, 32), MAT.steel, hamP, hamAnim, [0, 15.6, 0.6]);
    // hammer fork tail engaging the saw wheel
    this.addObject(box(1.1, 7.5, 0.9), MAT.steelSatin, hamP, hamAnim, [1.3, -3.4, 3.2]);

    // ---------- demonstration clock hands & dial chapter ring (central arbor) ----------
    const handCenterP: [number, number, number] = [POS.center[0], POS.center[1], 0];

    // 1. Alarm Setting Hand (сигнальная стрелка - Slava spear arrow)
    this.addObject(alarmHandMesh(18.0, 7.0, 7.35), MAT.cyan, handCenterP,
      (s) => [-s.alarmHandAngle, 0]);

    // 2. Hour Hand (часовая стрелка - tapered vintage sword, drops axially with hour wheel)
    this.addObject(hourHandMesh(16.5, 7.8, 8.2), MAT.steelSatin, handCenterP,
      (s) => [-s.hourHandAngle, -s.hourWheelDrop * SPEC.hourWheelAxialDrop]);

    // 3. Minute Hand (минутная стрелка - long sword hand)
    this.addObject(minuteHandMesh(23.5, 8.6, 8.95), MAT.dark, handCenterP,
      (s) => [-s.minuteHandAngle, 0]);

    // 4. Second Hand (секундная стрелка - Soviet signature red needle with counterweight)
    this.addObject(secondHandMesh(24.5, 6.0, 9.3, 9.55), MAT.red, handCenterP,
      (s) => [-s.secondHandAngle, 0]);

    // 5. Central Hub / Cap (колпачок стрелок)
    this.addObject(disc(1.2, 9.1, 9.9, 24), MAT.gold, handCenterP);

    // 6. Demonstration Skeleton Dial Ring (циферблат с делениями)
    this.addObject(dialRingMesh(20.0, 26.5, 6.4, 6.8), MAT.dialSilver, handCenterP);

    // 12 hour indices around the dial chapter ring
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const isQuarter = i % 3 === 0;
      const markerW = isQuarter ? 1.4 : 0.8;
      const markerL = isQuarter ? 3.0 : 2.0;
      this.addObject(
        box(markerW, markerL, 0.45),
        isQuarter ? MAT.gold : MAT.dark,
        handCenterP,
        () => [-a, 0],
        [0, 23.2, 7.0]
      );
    }

    // Dial standoffs to mainplate
    for (const [px, py] of [[-18, -16], [18, -16], [-18, 16], [18, 16]] as const) {
      this.addObject(disc(0.8, 1.2, 6.4, 16), MAT.brass, [POS.center[0] + px * 0.7, POS.center[1] + py * 0.7, 0]);
    }

    // ---------- bridge screws (blued steel) ----------
    for (const [sx, sy] of [[-20, -20], [22, -18], [-24, 8], [10, 24]] as const) {
      this.addObject(disc(1.3, 5.6, 6.4, 20), MAT.blued, [sx, sy, 0]);
    }
  }

  // ---------------- camera ----------------

  private activePointers = new Map<number, { x: number; y: number }>();
  private prevPinchDist = 0;

  private attachCameraControls() {
    let lastTap = 0;

    this.canvas.addEventListener('pointerdown', (e) => {
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.canvas.setPointerCapture(e.pointerId);

      // double tap to reset view
      const now = performance.now();
      if (this.activePointers.size === 1 && now - lastTap < 300) {
        this.setCameraView('default');
      }
      lastTap = now;
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.activePointers.has(e.pointerId)) return;
      const prev = this.activePointers.get(e.pointerId)!;
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.activePointers.size === 1) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        this.yaw += dx * 0.008;
        this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dy * 0.008));
      } else if (this.activePointers.size >= 2) {
        const pts = Array.from(this.activePointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this.prevPinchDist > 0 && dist > 10) {
          const factor = this.prevPinchDist / dist;
          this.dist = Math.max(35, Math.min(240, this.dist * (1 + (factor - 1) * 0.8)));
        }
        this.prevPinchDist = dist;
      }
    });

    const removePointer = (e: PointerEvent) => {
      this.activePointers.delete(e.pointerId);
      if (this.activePointers.size < 2) {
        this.prevPinchDist = 0;
      }
    };

    this.canvas.addEventListener('pointerup', removePointer);
    this.canvas.addEventListener('pointercancel', removePointer);

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist = Math.max(35, Math.min(240, this.dist * (1 + e.deltaY * 0.001)));
    }, { passive: false });
  }

  setCameraView(view: 'default' | 'demo' | 'top' | 'escapement') {
    if (view === 'default') {
      this.yaw = 0.35;
      this.pitch = 0.62;
      this.dist = 105;
      this.target = [0, 0, -1];
    } else if (view === 'demo' || view === 'top') {
      // Demonstration view looking at the dial face and 4 hands
      this.yaw = 0.06;
      this.pitch = 1.32;
      this.dist = 78;
      this.target = [16.6, 10.3, 4];
    } else if (view === 'escapement') {
      this.yaw = -0.65;
      this.pitch = 0.45;
      this.dist = 52;
      this.target = [-11, 14, 2];
    }
  }

  resize() {
    if (!this.device) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.depthTex?.destroy();
      this.depthTex = this.device.createTexture({
        size: [w, h],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
  }

  onEvents(events: SimEvent[]) {
    for (const e of events) {
      if (e.type === 'strike') this.bellFlash = Math.min(1, 0.4 + e.value * 0.6);
    }
  }

  render(snap: SimSnapshot) {
    if (!this.ok) return;
    this.resize();

    // update hairspring breathing from the balance angle
    const hsVerts = hairspringVertices(6.5, 1.1, 5.0, 0.4, HAIRSPRING_SEGMENTS, snap.balanceAngle, 7.4);
    this.device.queue.writeBuffer(this.hsVBuf, 0, hsVerts);

    // camera - adjust FOV when in portrait mode so the movement remains fully visible
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const baseFov = (38 * Math.PI) / 180;
    const fovY = aspect < 1 ? 2 * Math.atan(Math.tan(baseFov / 2) / aspect) : baseFov;
    const proj = m4perspective(fovY, aspect, 1, 500);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const eye = [
      this.target[0] + this.dist * cp * Math.sin(this.yaw),
      this.target[1] + this.dist * cp * Math.cos(this.yaw),
      this.target[2] + this.dist * sp,
    ];
    const view = m4lookAt(eye, this.target, [0, 0, 1]);
    const viewProj = m4mul(proj, view);

    const f = new Float32Array(44);
    f.set(viewProj, 0);
    f.set([eye[0], eye[1], eye[2], 0], 16);
    f.set([0.5, -0.35, -0.79, 0], 20);      // key light dir
    f.set([2.6, 2.5, 2.3, 0], 24);          // key light color
    f.set([-0.6, 0.5, -0.4, 0], 28);        // fill dir
    f.set([0.5, 0.55, 0.7, 0], 32);         // fill color
    f.set([0.32, 0.34, 0.4, 0], 36);        // sky ambient
    f.set([0.12, 0.1, 0.08, 0], 40);        // ground ambient
    this.device.queue.writeBuffer(this.frameUBO, 0, f);

    // per-object uniforms
    this.bellFlash = Math.max(0, this.bellFlash - 0.03);
    for (const o of this.objects) {
      const [spin, zOff] = o.anim(snap);
      let model = m4mul(m4translate(o.pivot[0], o.pivot[1], o.pivot[2] + zOff), m4rotZ(spin));
      if (o.local[0] || o.local[1] || o.local[2]) {
        model = m4mul(model, m4translate(o.local[0], o.local[1], o.local[2]));
      }
      const u = new Float32Array(32);
      u.set(model, 0);
      u.set([o.mat.color[0], o.mat.color[1], o.mat.color[2], o.mat.metallic], 16);
      u.set([o.mat.roughness, 0, 0, 0], 20);
      const em = o === this.objects[0] ? this.bellFlash : 0; // bell is object 0
      u.set([em * 0.5, em * 0.5, em * 0.55, 0], 24);
      u.set([0, 0, 0, 0], 28);
      this.device.queue.writeBuffer(o.ubuf, 0, u);
    }

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.ctx.getCurrentTexture().createView(),
        clearValue: { r: 0.045, g: 0.05, b: 0.07, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTex.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.frameBind);
    for (const o of this.objects) {
      pass.setBindGroup(1, o.bind);
      pass.setVertexBuffer(0, o.mesh.vbuf);
      pass.setIndexBuffer(o.mesh.ibuf, 'uint32');
      pass.drawIndexed(o.mesh.count);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
