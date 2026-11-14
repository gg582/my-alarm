/**
 * Slava5671Renderer — WebGPU forward renderer for the cal. 5671 movement.
 *
 * · Procedural meshes (see meshes.ts): mainplate, openwork bridges, gear train
 *   (brass wheels / steel pinions), 15-tooth club-tooth escape wheel, pallet fork with
 *   ruby pallets, screwless balance with staff & double roller, ruby impulse jewel,
 *   flat hairspring rebuilt every frame with Archimedean breathing, twin-pin regulator,
 *   motion works, alarm setting train and stop spring with axial release, alarm barrel,
 *   saw-tooth hammer-fork wheel, hammer, and the stamped-steel bell (lathe).
 * · PBR: metallic-workflow Cook–Torrance (GGX/Smith/Schlick), two key lights +
 *   hemispherical ambient + environment sheen. Materials differentiate brushed brass,
 *   polished & blued steel, glossy synthetic ruby and stamped bell steel. Depth-sorted
 *   alpha blending exposes the movement through the dial, bridges and bell cover.
 */

import {
  extrudeProfile, gearOutline, pinionOutline, escapeWheelMesh,
  sawWheelOutline, lathe, box, disc, hairspringVertices, hairspringIndices,
  spokedGearMesh, hourHandMesh, minuteHandMesh, alarmHandMesh,
  flatBarMesh, palletForkMesh, palletStonesMesh, balanceCockMesh,
  alarmGuardMesh, hammerForkMesh, perforatedPlateMesh, ringMesh,
  alarmWheelOutline, alarmStopSpringMesh,
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
function m4orbitView(eye: number[], yaw: number, pitch: number): Mat4 {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const z = [cp * sy, cp * cy, sp];
  const xLength = Math.hypot(sp, cp * sy);
  const x = xLength > 1e-6 ? [sp / xLength, 0, -cp * sy / xLength] : [1, 0, 0];
  const y = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ];
  const m = m4identity();
  m[0] = x[0]; m[1] = y[0]; m[2] = z[0];
  m[4] = x[1]; m[5] = y[1]; m[6] = z[1];
  m[8] = x[2]; m[9] = y[2]; m[10] = z[2];
  m[12] = -dot3(x, eye);
  m[13] = -dot3(y, eye);
  m[14] = -dot3(z, eye);
  return m;
}
const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

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
@group(1) @binding(1) var objSampler : sampler;
@group(1) @binding(2) var objTexture : texture_2d<f32>;

struct VOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) world : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) localXY : vec2<f32>,
};

@vertex
fn vs(@location(0) p : vec3<f32>, @location(1) n : vec3<f32>) -> VOut {
  var o : VOut;
  let wp = obj.model * vec4<f32>(p, 1.0);
  o.pos = frame.viewProj * wp;
  o.world = wp.xyz;
  o.normal = (obj.model * vec4<f32>(n, 0.0)).xyz;
  o.localXY = p.xy;
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
  var albedo = obj.baseColor;
  if (obj.flags > 0.5) {
    let uv = vec2<f32>(v.localXY.x / 53.0 + 0.5, 0.5 - v.localXY.y / 53.0);
    albedo = textureSample(objTexture, objSampler, uv).rgb;
    let ink = 1.0 - smoothstep(0.2, 0.72, dot(albedo, vec3<f32>(0.299, 0.587, 0.114)));
    return vec4<f32>(albedo, max(obj.pad0, ink * 0.94));
  }
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
  return vec4<f32>(col, obj.pad0);
}
`;

// ---------------- materials ----------------

interface Material {
  color: [number, number, number];
  metallic: number;
  roughness: number;
  opacity?: number;
}

const MAT = {
  nickelPlate: { color: [0.66, 0.68, 0.7], metallic: 1, roughness: 0.38, opacity: 0.26 } as Material,
  brass: { color: [0.72, 0.55, 0.24], metallic: 1, roughness: 0.3 } as Material,
  brassBright: { color: [0.8, 0.62, 0.28], metallic: 1, roughness: 0.16 } as Material,
  steel: { color: [0.72, 0.74, 0.78], metallic: 1, roughness: 0.14 } as Material,
  steelSatin: { color: [0.6, 0.62, 0.66], metallic: 1, roughness: 0.35 } as Material,
  blued: { color: [0.1, 0.18, 0.5], metallic: 1, roughness: 0.2 } as Material,
  ruby: { color: [0.55, 0.015, 0.05], metallic: 0.15, roughness: 0.06 } as Material,
  bell: { color: [0.78, 0.8, 0.84], metallic: 1, roughness: 0.22, opacity: 0.16 } as Material,
  dark: { color: [0.16, 0.16, 0.18], metallic: 0.9, roughness: 0.5 } as Material,
  red: { color: [0.88, 0.12, 0.18], metallic: 0.85, roughness: 0.25 } as Material,
  cyan: { color: [0.06, 0.58, 0.88], metallic: 0.9, roughness: 0.22 } as Material,
  gold: { color: [0.88, 0.72, 0.25], metallic: 0.95, roughness: 0.18 } as Material,
  dialSilver: { color: [0.84, 0.86, 0.89], metallic: 0.5, roughness: 0.4 } as Material,
  dialIvory: { color: [0.87, 0.85, 0.73], metallic: 0.05, roughness: 0.72, opacity: 0.12 } as Material,
};

// ---------------- scene objects ----------------

interface GpuMesh {
  vbuf: GPUBuffer;
  ibuf: GPUBuffer;
  count: number;
  center: [number, number, number];
}

type SceneView = 'always' | 'movement' | 'demo';

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
  view: SceneView;
  textured: boolean;
}

const HAIRSPRING_SEGMENTS = 260;

export class Slava5671Renderer {
  private device!: GPUDevice;
  private defaultTexture!: GPUTexture;
  private dialTexture!: GPUTexture;
  private sampler!: GPUSampler;
  private ctx!: GPUCanvasContext;
  private pipeline!: GPURenderPipeline;
  private transparentPipeline!: GPURenderPipeline;
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

  // camera (target & smoothed current)
  private targetYaw = 0.35;
  private targetPitch = 0.62;
  private targetDist = 105;
  private targetLookAt = [0, 0, -1];

  private currentYaw = 0.35;
  private currentPitch = 0.62;
  private currentDist = 105;
  private currentLookAt = [0, 0, -1];

  private bellFlash = 0;
  private viewMode: 'default' | 'demo' | 'escapement' = 'default';
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
    this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.defaultTexture = this.device.createTexture({
      size: [1, 1], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture({ texture: this.defaultTexture }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
    this.dialTexture = this.createDialTexture();
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
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
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
    this.transparentPipeline = this.device.createRenderPipeline({
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
      fragment: {
        module,
        entryPoint: 'fs',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
    });

    this.buildScene();
    this.resize();
    this.ok = true;
    return true;
  }

  private createDialTexture(): GPUTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;
    const center = 512;
    ctx.fillStyle = '#e9e5d6';
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.strokeStyle = '#9d998b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(center, center, 486, 0, Math.PI * 2);
    ctx.stroke();

    for (let i = 0; i < 60; i++) {
      const angle = (i / 60) * Math.PI * 2 - Math.PI / 2;
      const hour = i % 5 === 0;
      const quarter = i % 15 === 0;
      const outer = 444;
      const inner = hour && !quarter ? 394 : 430;
      ctx.strokeStyle = hour ? '#4a4b48' : '#85847b';
      ctx.lineWidth = hour ? 8 : 4;
      ctx.beginPath();
      ctx.moveTo(center + Math.cos(angle) * inner, center + Math.sin(angle) * inner);
      ctx.lineTo(center + Math.cos(angle) * outer, center + Math.sin(angle) * outer);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '300 112px "Arial Narrow", Arial, sans-serif';
    const numerals: Array<[string, number, number]> = [
      ['12', 512, 151], ['3', 866, 512], ['6', 512, 866], ['9', 158, 512],
    ];
    for (const [text, x, y] of numerals) {
      ctx.fillStyle = '#303431';
      ctx.fillText(text, x, y);
    }
    ctx.fillStyle = '#555850';
    ctx.font = '500 34px Arial, sans-serif';
    ctx.fillText('SLAVA', center, 362);
    ctx.font = '500 25px Arial, sans-serif';
    ctx.fillText('11 JEWELS', center, 638);
    ctx.font = '500 22px Arial, sans-serif';
    ctx.fillText('MADE IN USSR', center, 925);

    const texture = this.device.createTexture({
      size: [canvas.width, canvas.height], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture({ source: canvas }, { texture }, [canvas.width, canvas.height]);
    return texture;
  }

  private uploadMesh(data: MeshData): GpuMesh {
    const vbuf = this.device.createBuffer({ size: data.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(vbuf, 0, data.vertices);
    const ibuf = this.device.createBuffer({ size: data.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(ibuf, 0, data.indices);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.vertices.length; i += 6) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], data.vertices[i + axis]);
        max[axis] = Math.max(max[axis], data.vertices[i + axis]);
      }
    }
    const center: [number, number, number] = [
      (min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2,
    ];
    return { vbuf, ibuf, count: data.indices.length, center };
  }

  private addObject(
    data: MeshData, mat: Material,
    pivot: [number, number, number],
    anim: (s: SimSnapshot) => [number, number] = () => [0, 0],
    local: [number, number, number] = [0, 0, 0],
    view: SceneView = 'always',
    texture?: GPUTexture,
  ): SceneObject {
    const mesh = this.uploadMesh(data);
    const ubuf = this.device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bind = this.device.createBindGroup({ layout: this.objLayout, entries: [
      { binding: 0, resource: { buffer: ubuf } },
      { binding: 1, resource: this.sampler },
      { binding: 2, resource: (texture ?? this.defaultTexture).createView() },
    ] });
    const obj: SceneObject = { mesh, bind, ubuf, pivot, local, mat, anim, emissive: [0, 0, 0], view, textured: texture !== undefined };
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

    // ---------- mainplate (55.8 mm reduced caliber) ----------
    this.addObject(disc(SPEC.mainplateRadius, -1.2, 1.2, 96), MAT.nickelPlate, [0, 0, 0]);

    // ---------- gear positions (wheel-pinion centre distances from pitch radii) ----------
    const POS = {
      barrel: [-13, 12] as const,
      center: [0, 0] as const,
      third: [9, 5] as const,
      fourth: [-1, -5] as const,
      escape: [-4.5, -12.5] as const,
      fork: [1, -15.8] as const,
      balance: [5.5, -18.8] as const,
      alarmBarrel: [15, 9] as const,
      saw: [13, -5] as const,
      hammer: [17, -9] as const,
    };

    // ---------- time barrel (brass, verified) ----------
    this.addObject(extrudeProfile(gearOutline(t.barrel.wheelTeeth, t.barrel.pitch, 0.75), 0.4, 3.4), MAT.brass, [POS.barrel[0], POS.barrel[1], 0],
      (s) => [s.barrelAngle, 0]);
    this.addObject(extrudeProfile(sawWheelOutline(7, 3.4), 3.4, 4.2), MAT.steelSatin, [POS.barrel[0], POS.barrel[1], 0],
      () => [0, 0]);

    // ---------- center wheel + minute pinion ----------
    this.addObject(spokedGearMesh(t.center.wheelTeeth, t.center.pitch, 0.65, 0.4, 2.2), MAT.brass, [POS.center[0], POS.center[1], 0],
      (s) => [s.centerAngle, 0]);
    this.addObject(extrudeProfile(pinionOutline(t.center.pinion, 2.6), 2.6, 4.4), MAT.steel, [POS.center[0], POS.center[1], 0],
      (s) => [s.centerAngle, 0]);

    // ---------- third wheel ----------
    this.addObject(spokedGearMesh(t.third.wheelTeeth, t.third.pitch, 0.6, 0.4, 2.2), MAT.brass, [POS.third[0], POS.third[1], 0],
      (s) => [s.thirdAngle, 0]);
    this.addObject(extrudeProfile(pinionOutline(t.third.pinion, 1.5), 2.2, 3.8), MAT.steel, [POS.third[0], POS.third[1], 0],
      (s) => [s.thirdAngle, 0]);

    // ---------- fourth wheel ----------
    this.addObject(spokedGearMesh(t.fourth.wheelTeeth, t.fourth.pitch, 0.55, 0.4, 2.0), MAT.brass, [POS.fourth[0], POS.fourth[1], 0],
      (s) => [s.fourthAngle, 0]);
    this.addObject(extrudeProfile(pinionOutline(t.fourth.pinion, 1.8), 2.0, 3.6), MAT.steel, [POS.fourth[0], POS.fourth[1], 0],
      (s) => [s.fourthAngle, 0]);

    // ---------- open five-spoke escape wheel with 15 club teeth ----------
    this.addObject(escapeWheelMesh(SPEC.escapeWheelTeeth, t.escape.pitch, 2.2, 3.0), MAT.brassBright, [POS.escape[0], POS.escape[1], 0],
      (s) => [s.escapeAngle, 0]);
    this.addObject(extrudeProfile(pinionOutline(t.escape.pinion, 1.4), 1.4, 3.4), MAT.steel, [POS.escape[0], POS.escape[1], 0],
      (s) => [s.escapeAngle, 0]);
    this.addObject(disc(0.3, 1.0, 6.15, 24), MAT.steel, [POS.escape[0], POS.escape[1], 0],
      (s) => [s.escapeAngle, 0]);
    this.addObject(disc(0.15, 6.15, 6.62, 20), MAT.steel, [POS.escape[0], POS.escape[1], 0],
      (s) => [s.escapeAngle, 0]);

    // ---------- Swiss lever fork with separate ruby pallets ----------
    const forkP: [number, number, number] = [POS.fork[0], POS.fork[1], 0];
    const forkAnim = (s: SimSnapshot): [number, number] => [s.forkAngle, 0];
    this.addObject(palletForkMesh(), MAT.steel, forkP, forkAnim);
    this.addObject(palletStonesMesh(), MAT.ruby, forkP, forkAnim);
    this.addObject(disc(0.24, 2.2, 5.5, 24), MAT.steel, forkP, forkAnim);
    this.addObject(disc(0.15, 5.5, 5.76, 20), MAT.steel, forkP, forkAnim);
    this.addObject(disc(0.14, 3.0, 4.3, 12), MAT.steel, forkP, forkAnim, [4.15, -2.7, 0]);
    this.addObject(disc(0.22, 2.4, 4.1, 16), MAT.brassBright, forkP, () => [0, 0], [3.65, -1.75, 0]);
    this.addObject(disc(0.22, 2.4, 4.1, 16), MAT.brassBright, forkP, () => [0, 0], [3.65, -3.85, 0]);

    const palletBridge: [number, number][] = [
      [-3.0, 2.6], [-2.75, 3.45], [-1.9, 3.8], [-1.0, 3.45], [-0.25, 2.55],
      [0.8, 1.45], [1.35, 0.65], [1.4, -0.2], [0.85, -0.95], [-0.1, -1.55],
      [-0.85, -3.2], [-1.45, -4.0], [-2.35, -3.55], [-2.8, -2.2], [-2.65, -0.65],
      [-2.9, 0.85],
    ];
    this.addObject(perforatedPlateMesh(palletBridge, [
      { x: 0, y: 0, radius: 0.52 },
      { x: -2.0, y: 2.8, radius: 0.58 },
      { x: -1.4, y: -2.55, radius: 0.58 },
    ], 4.9, 5.55), MAT.nickelPlate, forkP);
    this.addObject(ringMesh(0.82, 0.48, 5.48, 5.64, 32), MAT.steelSatin, forkP);
    this.addObject(ringMesh(0.47, 0.16, 5.51, 5.67, 32), MAT.ruby, forkP);
    for (const [x, y] of [[-2.0, 2.8], [-1.4, -2.55]] as const) {
      this.addObject(disc(0.82, 5.52, 5.82, 32), MAT.steel, forkP, () => [0, 0], [x, y, 0]);
      this.addObject(box(1.12, 0.18, 0.08), MAT.dark, forkP, () => [0.35, 0], [x, y, 5.84]);
    }

    // ---------- screwless balance (verified безвинтовый), heavy rim ----------
    const balP: [number, number, number] = [POS.balance[0], POS.balance[1], 0];
    const balAnim = (s: SimSnapshot): [number, number] => [s.balanceAngle, 0];
    // rim: lathe ring
    const rimProfile: [number, number][] = [[6.4, 5.4], [7.4, 5.4], [7.6, 6.0], [7.4, 6.6], [6.4, 6.6], [6.2, 6.0], [6.4, 5.4]];
    this.addObject(lathe(rimProfile, 72), MAT.brassBright, balP, balAnim);
    // monometallic rim with a single machined crossbar
    this.addObject(flatBarMesh(-6.6, 0, 6.6, 0, 1.3, 1.3, 5.55, 6.45), MAT.brassBright, balP, balAnim);
    // staff
    this.addObject(disc(0.5, 3.2, 9.05, 16), MAT.steel, balP, balAnim);
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
    const hsMesh: GpuMesh = { vbuf: this.hsVBuf, ibuf: this.hsIBuf, count: this.hsCount, center: [0, 0, 7.4] };
    const hsUbuf = this.device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const hsBind = this.device.createBindGroup({ layout: this.objLayout, entries: [
      { binding: 0, resource: { buffer: hsUbuf } },
      { binding: 1, resource: this.sampler },
      { binding: 2, resource: this.defaultTexture.createView() },
    ] });
    this.hsObject = {
      mesh: hsMesh, bind: hsBind, ubuf: hsUbuf,
      pivot: balP, local: [0, 0, 0], mat: MAT.blued, anim: () => [0, 0], emissive: [0, 0, 0], view: 'always', textured: false,
    };
    this.objects.push(this.hsObject);
    // hairspring stud on the cock (fixed)
    this.addObject(disc(0.48, 6.8, 8.4, 20), MAT.brass, balP, () => [0, 0], [5.05, 1.4, 0]);

    // ---------- early two-ear balance cock with a screwed staff ----------
    this.addObject(balanceCockMesh(), MAT.nickelPlate, balP);
    this.addObject(ringMesh(0.9, 0.52, 8.58, 8.76, 40), MAT.steelSatin, balP);
    this.addObject(ringMesh(0.51, 0.17, 8.6, 8.74, 32), MAT.ruby, balP);
    this.addObject(disc(0.41, 8.76, 8.86, 32), MAT.ruby, balP);
    this.addObject(disc(0.2, 8.86, 9.12, 20), MAT.steel, balP);
    for (const [x, y] of [[-6.2, 3.7], [1.0, -6.4]] as const) {
      this.addObject(disc(0.9, 8.62, 8.94, 32), MAT.steel, balP, () => [0, 0], [x, y, 0]);
      this.addObject(box(1.25, 0.2, 0.08), MAT.dark, balP, () => [0.35, 0], [x, y, 8.96]);
    }

    // ---------- hairspring regulator with a fine-adjustment screw and twin pins ----------
    this.addObject(ringMesh(0.72, 0.3, 8.64, 8.82, 32), MAT.steelSatin, balP);
    this.addObject(flatBarMesh(0.3, 0.1, 4.8, 1.25, 0.52, 0.34, 8.66, 8.82), MAT.steelSatin, balP);
    this.addObject(extrudeProfile([[4.25, 1.0], [5.45, 1.25], [4.35, 1.55]], 8.66, 8.82), MAT.steel, balP);
    this.addObject(disc(0.1, 7.05, 8.86, 16), MAT.steel, balP, () => [0, 0], [4.65, 1.08, 0]);
    this.addObject(disc(0.1, 7.05, 8.86, 16), MAT.steel, balP, () => [0, 0], [4.95, 1.38, 0]);
    this.addObject(disc(0.32, 8.65, 8.98, 24), MAT.steel, balP, () => [0, 0], [1.1, -1.25, 0]);
    this.addObject(box(0.42, 0.09, 0.05), MAT.dark, balP, () => [0.35, 0], [1.1, -1.25, 9.0]);

    // ---------- nickel-plated train and alarm bridges ----------
    const bridgeZ = 5.2;
    const trainScrews = [[-20, 15], [-16, 3], [-5, 18], [7, 10], [-5.6, -13.3]] as const;
    const alarmScrews = [[18, 19], [22, 7], [18, -7]] as const;
    const trainBridge: [number, number][] = [
      [-24.5, 12], [-23.5, 19], [-18, 23], [-10, 24], [-3, 22], [4, 18],
      [10, 13], [12.5, 8], [10.5, 4.2], [5, 3.4], [2, 1], [2, -4],
      [1.5, -7], [0, -10], [-2, -13], [-4, -15.5], [-6.5, -16], [-9, -14],
      [-11, -10], [-12, -6], [-15, -1], [-21, 3], [-24, 7],
    ];
    this.addObject(perforatedPlateMesh(trainBridge, [
      { x: POS.barrel[0], y: POS.barrel[1], radius: 0.85 },
      { x: POS.center[0], y: POS.center[1], radius: 0.65 },
      { x: POS.third[0], y: POS.third[1], radius: 0.58 },
      { x: POS.fourth[0], y: POS.fourth[1], radius: 0.58 },
      { x: POS.escape[0], y: POS.escape[1], radius: 0.52 },
      ...trainScrews.map(([x, y]) => ({ x, y, radius: 0.62 })),
    ], bridgeZ, bridgeZ + 1.2), MAT.nickelPlate, [0, 0, 0]);
    const alarmBridge: [number, number][] = [
      [10, 22], [18, 23], [24, 18], [26, 10], [25, 5], [22, 3],
      [20, 5], [20, 9], [18, 12], [17, 10], [18, 5], [20, 1],
      [22, -4], [22, -8], [18, -12], [14, -10], [11.5, -7], [12, -4],
      [16, 3], [13, 10], [9, 15],
    ];
    this.addObject(perforatedPlateMesh(alarmBridge, [
      { x: POS.alarmBarrel[0], y: POS.alarmBarrel[1], radius: 0.9 },
      { x: POS.saw[0], y: POS.saw[1], radius: 0.62 },
      { x: POS.hammer[0], y: POS.hammer[1], radius: 0.58 },
      ...alarmScrews.map(([x, y]) => ({ x, y, radius: 0.62 })),
    ], bridgeZ, bridgeZ + 1.2), MAT.nickelPlate, [0, 0, 0]);
    for (const p of [POS.barrel, POS.center, POS.third, POS.fourth]) {
      this.addObject(ringMesh(0.92, 0.3, bridgeZ + 1.14, bridgeZ + 1.34, 32), MAT.brassBright, [p[0], p[1], 0]);
    }
    for (const p of [POS.alarmBarrel, POS.saw, POS.hammer]) {
      this.addObject(ringMesh(0.82, 0.27, bridgeZ + 1.14, bridgeZ + 1.34, 32), MAT.brassBright, [p[0], p[1], 0]);
    }
    this.addObject(ringMesh(0.82, 0.48, bridgeZ + 1.08, bridgeZ + 1.24, 32), MAT.steelSatin, [POS.escape[0], POS.escape[1], 0]);
    this.addObject(ringMesh(0.47, 0.16, bridgeZ + 1.11, bridgeZ + 1.27, 32), MAT.ruby, [POS.escape[0], POS.escape[1], 0]);

    // ---------- motion works and alarm setting train on the dial side ----------
    const hourAnim = (s: SimSnapshot): [number, number] => [-s.hourHandAngle, -s.hourWheelDrop * SPEC.hourWheelAxialDrop];
    this.addObject(extrudeProfile(gearOutline(SPEC.motionWorks.hourWheelTeeth, 8.0, 0.45), 3.4, 4.25), MAT.steelSatin,
      [POS.center[0], POS.center[1], 0], hourAnim);
    this.addObject(extrudeProfile([[-0.6, -0.7], [0.6, -0.55], [0.45, 0.75], [-0.45, 0.65]], 4.2, 5.1), MAT.steel,
      [POS.center[0], POS.center[1], 0], hourAnim, [0, -7.6, 0]);
    const alarmAnim = (s: SimSnapshot): [number, number] => [-s.alarmHandAngle, 0];
    this.addObject(extrudeProfile(alarmWheelOutline(72, 7.2), 4.8, 5.6), MAT.brass,
      [POS.center[0], POS.center[1], 0], alarmAnim);
    this.addObject(extrudeProfile(pinionOutline(SPEC.motionWorks.cannonPinionTeeth, 1.6), 5.6, 6.3), MAT.steel,
      [POS.center[0], POS.center[1], 0], (s) => [-s.minuteHandAngle, 0]);
    const minuteP: [number, number, number] = [-4.6, 2.4, 0];
    this.addObject(extrudeProfile(gearOutline(SPEC.motionWorks.minuteWheelTeeth, 3.4, 0.35), 5.25, 5.8), MAT.brassBright,
      minuteP, (s) => [s.minuteHandAngle / 3, 0]);
    this.addObject(extrudeProfile(pinionOutline(SPEC.motionWorks.minuteWheelPinion, 1.1), 4.55, 5.3), MAT.steel,
      minuteP, (s) => [s.minuteHandAngle / 3, 0]);
    const alarmIdlerP: [number, number, number] = [7.6, 3.2, 0];
    this.addObject(extrudeProfile(gearOutline(30, 3.0, 0.35), 5.0, 5.55), MAT.brassBright,
      alarmIdlerP, (s) => [s.alarmHandAngle * 6.5, 0]);
    this.addObject(extrudeProfile(pinionOutline(10, 1.1), 5.5, 6.05), MAT.steel,
      alarmIdlerP, (s) => [s.alarmHandAngle * 6.5, 0]);
    const alarmSettingP: [number, number, number] = [7.2, 7.8, 0];
    this.addObject(extrudeProfile(pinionOutline(12, 1.4), 5.65, 6.2), MAT.brassBright,
      alarmSettingP, (s) => [-s.alarmHandAngle * 19.5, 0]);
    this.addObject(disc(0.24, 4.6, 6.3, 20), MAT.steel, alarmSettingP,
      (s) => [-s.alarmHandAngle * 19.5, 0]);
    const stopP: [number, number, number] = [10.2, 5.5, 0];
    const stopAnim = (s: SimSnapshot): [number, number] => [-s.hourWheelDrop * 0.16, 0];
    this.addObject(alarmStopSpringMesh(), MAT.steelSatin, stopP, stopAnim);
    for (const [x, y, length] of [[0.02, -2.8, 1.8], [0.1, -0.7, 1.25]] as const) {
      this.addObject(box(0.24, length, 0.06), MAT.dark, stopP, stopAnim, [x, y, 6.17]);
    }
    this.addObject(flatBarMesh(10.35, 0.2, 17.1, -3.1, 0.38, 0.3, 4.15, 4.45), MAT.steel,
      [0, 0, 0], (s) => [-s.hourWheelDrop * 0.025, 0]);

    // ---------- alarm barrel (brass, slipping bridle) ----------
    this.addObject(extrudeProfile(gearOutline(SPEC.alarmBarrel.wheelTeeth, 12.5, 0.75), 0.4, 3.0), MAT.brass, [POS.alarmBarrel[0], POS.alarmBarrel[1], 0],
      (s) => [-s.alarmWheelAngle / (SPEC.alarmBarrel.wheelTeeth / SPEC.alarmBarrel.pinion), 0]);
    this.addObject(extrudeProfile(sawWheelOutline(7, 3.0), 3.0, 3.8), MAT.steelSatin, [POS.alarmBarrel[0], POS.alarmBarrel[1], 0]);

    // ---------- hammer-fork saw wheel (14 teeth in the early movement) ----------
    this.addObject(extrudeProfile(sawWheelOutline(SPEC.hammerForkWheelTeeth, 4.6), 2.4, 3.2), MAT.brassBright, [POS.saw[0], POS.saw[1], 0],
      (s) => [s.alarmWheelAngle, 0]);

    // ---------- pivoted alarm shut-off guard with a bent locking pawl ----------
    const guardP: [number, number, number] = [19.5, -2.5, 0];
    this.addObject(alarmGuardMesh(), MAT.steelSatin, guardP,
      (s) => [(s.alarmEnabled ? -0.12 : 0.18) + s.hourWheelDrop * 0.08, 0]);
    this.addObject(disc(0.46, 4.3, 5.0, 20), MAT.steel, guardP);

    // ---------- hammer: open crescent fork, bent bracket and cylindrical head ----------
    const hamP: [number, number, number] = [POS.hammer[0], POS.hammer[1], 0];
    const hamAnim = (s: SimSnapshot): [number, number] => [Math.PI / 4 + s.hammerAngle * 0.18, 0];
    this.addObject(hammerForkMesh(), MAT.steelSatin, hamP, hamAnim);
    this.addObject(disc(0.42, 2.0, 5.0, 20), MAT.steel, hamP);
    this.addObject(flatBarMesh(0, -0.2, 2.8, -2.4, 0.48, 0.34, 3.5, 3.85), MAT.steel, hamP, hamAnim);
    this.addObject(flatBarMesh(2.8, -2.4, 8.8, -3.1, 0.34, 0.28, 3.5, 3.85), MAT.steel, hamP, hamAnim);
    const headProfile: [number, number][] = [[0, 2.6], [1.6, 2.8], [2.0, 3.6], [2.0, 4.6], [1.6, 5.2], [0, 5.3]];
    this.addObject(lathe(headProfile, 32), MAT.steel, hamP, hamAnim, [9.2, -3.2, 0.6]);

    // ---------- translucent dial and the three original hand profiles ----------
    const handCenterP: [number, number, number] = [POS.center[0], POS.center[1], 0];
    this.addObject(disc(26.5, 6.4, 6.65, 96), MAT.dialIvory, handCenterP,
      () => [0, 0], [0, 0, 0], 'always', this.dialTexture);

    this.addObject(alarmHandMesh(22.0, 7.0, 7.2), MAT.brassBright, handCenterP,
      (s) => [-s.alarmHandAngle, 0], [0, 0, 0], 'always');
    this.addObject(hourHandMesh(18.0, 7.8, 8.0), MAT.blued, handCenterP,
      (s) => [-s.hourHandAngle, -s.hourWheelDrop * SPEC.hourWheelAxialDrop], [0, 0, 0], 'always');
    this.addObject(minuteHandMesh(23.5, 8.6, 8.8), MAT.blued, handCenterP,
      (s) => [-s.minuteHandAngle, 0], [0, 0, 0], 'always');
    this.addObject(disc(0.42, 8.8, 9.25, 20), MAT.steel, handCenterP,
      () => [0, 0], [0, 0, 0], 'always');

    for (const [px, py] of [[-18, -16], [18, -16], [-18, 16], [18, 16]] as const) {
      this.addObject(disc(0.8, 1.2, 6.4, 16), MAT.brass, [POS.center[0] + px * 0.7, POS.center[1] + py * 0.7, 0],
        () => [0, 0], [0, 0, 0], 'always');
    }

    // ---------- polished slotted bridge screws ----------
    for (const [sx, sy] of [...trainScrews, ...alarmScrews]) {
      this.addObject(disc(0.95, 6.38, 6.68, 32), MAT.steel, [sx, sy, 0]);
      this.addObject(box(1.3, 0.2, 0.08), MAT.dark, [sx, sy, 0], () => [0.35, 0], [0, 0, 6.7]);
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
        this.targetYaw -= dx * 0.006;
        this.targetPitch = Math.max(-1.48, Math.min(1.48, this.targetPitch - dy * 0.006));
      } else if (this.activePointers.size >= 2) {
        const pts = Array.from(this.activePointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this.prevPinchDist > 0 && dist > 10) {
          const factor = this.prevPinchDist / dist;
          this.targetDist = Math.max(30, Math.min(240, this.targetDist * factor));
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
      this.targetDist = Math.max(30, Math.min(240, this.targetDist * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });
  }

  setCameraView(view: 'default' | 'demo' | 'top' | 'escapement') {
    this.viewMode = view === 'top' ? 'demo' : view;
    if (view === 'default') {
      this.targetYaw = 0.35;
      this.targetPitch = 0.62;
      this.targetDist = 105;
      this.targetLookAt = [0, 0, -1];
    } else if (view === 'demo' || view === 'top') {
      // Demonstration view looking at the translucent dial and three hands
      this.targetYaw = 0.0;
      this.targetPitch = 1.35;
      this.targetDist = 92;
      this.targetLookAt = [0, 0, 4];
    } else if (view === 'escapement') {
      this.targetYaw = -0.35;
      this.targetPitch = 0.65;
      this.targetDist = 52;
      this.targetLookAt = [-1, -16, 2];
    }
  }

  resize() {
    if (!this.device) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (!this.depthTex || this.canvas.width !== w || this.canvas.height !== h) {
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

    // smooth camera interpolation
    const lerp = 0.18;
    this.currentYaw += (this.targetYaw - this.currentYaw) * lerp;
    this.currentPitch += (this.targetPitch - this.currentPitch) * lerp;
    this.currentDist += (this.targetDist - this.currentDist) * lerp;
    this.currentLookAt[0] += (this.targetLookAt[0] - this.currentLookAt[0]) * lerp;
    this.currentLookAt[1] += (this.targetLookAt[1] - this.currentLookAt[1]) * lerp;
    this.currentLookAt[2] += (this.targetLookAt[2] - this.currentLookAt[2]) * lerp;

    // camera - adjust FOV when in portrait mode so the movement remains fully visible
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const baseFov = (38 * Math.PI) / 180;
    const fovY = aspect < 1 ? 2 * Math.atan(Math.tan(baseFov / 2) / aspect) : baseFov;
    const proj = m4perspective(fovY, aspect, 1, 500);
    const cp = Math.cos(this.currentPitch), sp = Math.sin(this.currentPitch);
    const eye = [
      this.currentLookAt[0] + this.currentDist * cp * Math.sin(this.currentYaw),
      this.currentLookAt[1] + this.currentDist * cp * Math.cos(this.currentYaw),
      this.currentLookAt[2] + this.currentDist * sp,
    ];
    const view = m4orbitView(eye, this.currentYaw, this.currentPitch);
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
      if ((this.viewMode === 'demo' && o.view === 'movement') || (this.viewMode !== 'demo' && o.view === 'demo')) continue;
      const [spin, zOff] = o.anim(snap);
      let model = m4mul(m4translate(o.pivot[0], o.pivot[1], o.pivot[2] + zOff), m4rotZ(spin));
      if (o.local[0] || o.local[1] || o.local[2]) {
        model = m4mul(model, m4translate(o.local[0], o.local[1], o.local[2]));
      }
      const u = new Float32Array(32);
      u.set(model, 0);
      u.set([o.mat.color[0], o.mat.color[1], o.mat.color[2], o.mat.metallic], 16);
      u.set([o.mat.roughness, o.textured ? 1 : 0, o.mat.opacity ?? 1, 0], 20);
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
    pass.setBindGroup(0, this.frameBind);
    const visible = this.objects.filter((o) => !(
      (this.viewMode === 'escapement' && o.textured) ||
      (this.viewMode === 'demo' && o.view === 'movement') || (this.viewMode !== 'demo' && o.view === 'demo')
    ));
    const drawObject = (o: SceneObject) => {
      pass.setBindGroup(1, o.bind);
      pass.setVertexBuffer(0, o.mesh.vbuf);
      pass.setIndexBuffer(o.mesh.ibuf, 'uint32');
      pass.drawIndexed(o.mesh.count);
    };

    pass.setPipeline(this.pipeline);
    for (const o of visible) {
      if ((o.mat.opacity ?? 1) >= 1) drawObject(o);
    }

    const transparent = visible.filter((o) => (o.mat.opacity ?? 1) < 1);
    const distanceToCamera = (o: SceneObject) => {
      const [spin, zOff] = o.anim(snap);
      const c = Math.cos(spin), s = Math.sin(spin);
      const lx = o.local[0] + o.mesh.center[0], ly = o.local[1] + o.mesh.center[1];
      const x = o.pivot[0] + c * lx - s * ly;
      const y = o.pivot[1] + s * lx + c * ly;
      const z = o.pivot[2] + zOff + o.local[2] + o.mesh.center[2];
      return (x - eye[0]) ** 2 + (y - eye[1]) ** 2 + (z - eye[2]) ** 2;
    };
    transparent.sort((a, b) => distanceToCamera(b) - distanceToCamera(a));
    pass.setPipeline(this.transparentPipeline);
    for (const o of transparent) drawObject(o);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
