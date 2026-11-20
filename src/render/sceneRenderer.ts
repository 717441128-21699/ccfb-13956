/**
 * WebGL2 三维场景: 晷盘 + 晷针 + 实时投影影子 + 太阳方位指示。
 * 影子按真实太阳方向做平行投影, 本影(深)与半影(浅)分两层绘制。
 */
import { mat4, vec3 } from 'gl-matrix';
import { linkProgram, SCENE_VS, SCENE_FS, SHADOW_VS, SHADOW_FS } from './shaders';
import type { DialGeometry, PlaneFrame, Vec2 } from '../core/dialGeometry';
import { buildFinMesh, buildRodMesh, type TriangleMesh } from '../core/shadow';
import { add, dot, norm, projectOnPlane, scale, sub, type Vec3 } from '../core/vector3';

interface GPUMesh {
  vao: WebGLVertexArrayObject;
  vertexCount: number;
  indexCount: number;
  mode: number;
}

interface RenderObject {
  mesh: GPUMesh;
  model: mat4;
  color: [number, number, number];
  alpha: number;
  unlit: boolean;
}

export interface OrbitState {
  yaw: number;
  pitch: number;
  distance: number;
  target: vec3;
}

export class SceneRenderer {
  private gl: WebGL2RenderingContext;
  private sceneProg: WebGLProgram;
  private shadowProg: WebGLProgram;
  private objects: RenderObject[] = [];
  private shadowObjects: RenderObject[] = [];
  private sunDir: vec3 = [0.3, -0.5, 0.8];
  private frame: PlaneFrame;
  private radius: number;
  private proj = mat4.create();
  private view = mat4.create();
  orbit: OrbitState;

  constructor(canvas: HTMLCanvasElement, dial: DialGeometry) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.sceneProg = linkProgram(gl, SCENE_VS, SCENE_FS);
    this.shadowProg = linkProgram(gl, SHADOW_VS, SHADOW_FS);
    this.frame = dial.frame;
    this.radius = dial.radiusM;
    this.orbit = {
      yaw: dial.input.type === 'wall' ? Math.atan2(dial.frame.n.x, dial.frame.n.y) : Math.PI * 0.75,
      pitch: dial.input.type === 'wall' ? 0.25 : 0.6,
      distance: dial.radiusM * 4.2,
      target: [0, 0, dial.radiusM * 0.2],
    };
    this.buildScene(dial);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.07, 0.09, 0.12, 1);
  }

  // ------------------------------------------------------------------ mesh
  private uploadMesh(mesh: TriangleMesh, mode: number): GPUMesh {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('VAO 创建失败');
    gl.bindVertexArray(vao);

    const positions = new Float32Array(mesh.positions.length * 3);
    const normals = new Float32Array(mesh.positions.length * 3);
    mesh.positions.forEach((p, i) => {
      positions.set([p.x, p.y, p.z], i * 3);
    });
    this.computeNormals(mesh, normals);

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    const nrmBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    let indexCount = 0;
    if (mesh.indices.length > 0) {
      const idxBuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
      gl.bufferData(
        gl.ELEMENT_ARRAY_BUFFER,
        new Uint32Array(mesh.indices),
        gl.STATIC_DRAW,
      );
      indexCount = mesh.indices.length;
    }
    gl.bindVertexArray(null);
    return { vao, vertexCount: mesh.positions.length, indexCount, mode };
  }

  private computeNormals(mesh: TriangleMesh, out: Float32Array): void {
    const acc: Vec3[] = mesh.positions.map(() => ({ x: 0, y: 0, z: 0 }));
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = mesh.positions[mesh.indices[i]];
      const b = mesh.positions[mesh.indices[i + 1]];
      const c = mesh.positions[mesh.indices[i + 2]];
      const n = norm(cross3(sub(b, a), sub(c, a)));
      for (const idx of [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]]) {
        acc[idx] = add(acc[idx], n);
      }
    }
    acc.forEach((n, i) => {
      const nn = dot(n, n) > 1e-12 ? norm(n) : { x: 0, y: 0, z: 1 };
      out.set([nn.x, nn.y, nn.z], i * 3);
    });
  }

  private buildScene(dial: DialGeometry): void {
    const gl = this.gl;
    // 晷盘: 圆盘 (三角扇)
    const plate = this.uploadMesh(buildPlateMesh(this.radius, dial.frame.n, 64), gl.TRIANGLES);
    this.addObject(plate, mat4.create(), [0.82, 0.78, 0.68], 1, false);

    // 晷针: 赤道式用圆柱, 其余用三角鳍板
    const gMesh =
      dial.input.type === 'equatorial' ? buildRodMesh(dial, 28) : buildFinMesh(dial);
    const gpuG = this.uploadMesh(gMesh, gl.TRIANGLES);
    this.addObject(gpuG, mat4.create(), [0.25, 0.27, 0.32], 1, false);

    // 墙面式: 在盘后补一块墙面薄板
    if (dial.input.type === 'wall') {
      const wall = this.uploadMesh(
        buildBackingMesh(this.radius * 2.4, dial.frame.n, -0.02),
        gl.TRIANGLES,
      );
      this.addObject(wall, mat4.create(), [0.55, 0.52, 0.48], 1, false);
    } else {
      // 水平/赤道: 地面参考网格
      const ground = this.uploadMesh(buildGroundMesh(this.radius * 5), gl.LINES);
      this.addObject(ground, mat4.create(), [0.3, 0.34, 0.38], 0.5, true);
    }

    // 影子平面网格 (与晷盘重合, 略偏上避免 z-fighting)
    const shadowPlane = this.uploadMesh(
      buildPlateMesh(this.radius * 0.995, dial.frame.n, 64),
      gl.TRIANGLES,
    );
    const shadowModel = mat4.create();
    mat4.fromTranslation(shadowModel, [dial.frame.n.x * 0.0008, dial.frame.n.y * 0.0008, dial.frame.n.z * 0.0008]);
    this.shadowObjects.push({
      mesh: shadowPlane,
      model: shadowModel,
      color: [0, 0, 0],
      alpha: 0,
      unlit: true,
    });
  }

  private addObject(
    mesh: GPUMesh,
    model: mat4,
    color: [number, number, number],
    alpha: number,
    unlit: boolean,
  ): void {
    this.objects.push({ mesh, model, color, alpha, unlit });
  }

  /** 更新太阳方向 (ENU 单位向量) */
  setSunDirection(dir: Vec3): void {
    this.sunDir = [dir.x, dir.y, dir.z];
  }

  /**
   * 更新投影影子: 把晷针网格沿太阳方向投影到晷面平面, 生成压扁的影子网格。
   * @param penumbra 半影层 (0..1 透明度), umbra 本影层更实
   */
  updateShadow(dial: DialGeometry, penumbra: number, umbra: number): void {
    const gl = this.gl;
    // 清掉旧的动态影子 (保留第 0 个隐形承接面)
    this.shadowObjects = this.shadowObjects.slice(0, 1);
    const gMesh =
      dial.input.type === 'equatorial' ? buildRodMesh(dial, 28) : buildFinMesh(dial);
    const projected = projectMeshToPlane(gMesh, toVec3(this.sunDir), this.frame.n);
    if (projected.positions.length > 0) {
      const gpu = this.uploadMesh(projected, gl.TRIANGLES);
      const lift = mat4.create();
      mat4.fromTranslation(lift, [this.frame.n.x * 0.0012, this.frame.n.y * 0.0012, this.frame.n.z * 0.0012]);
      this.shadowObjects.push({
        mesh: gpu,
        model: lift,
        color: [0.05, 0.04, 0.03],
        alpha: umbra,
        unlit: true,
      });
    }
    void penumbra;
  }

  // ------------------------------------------------------------------ render
  resize(width: number, height: number): void {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    gl.canvas.width = Math.floor(width * dpr);
    gl.canvas.height = Math.floor(height * dpr);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    mat4.perspective(this.proj, Math.PI / 4.5, width / height, 0.01, 100);
  }

  render(): void {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // 相机轨道
    const cp = Math.cos(this.orbit.pitch);
    const eye: vec3 = [
      this.orbit.target[0] + this.orbit.distance * cp * Math.sin(this.orbit.yaw),
      this.orbit.target[1] + this.orbit.distance * cp * Math.cos(this.orbit.yaw),
      this.orbit.target[2] + this.orbit.distance * Math.sin(this.orbit.pitch),
    ];
    mat4.lookAt(this.view, eye, this.orbit.target, [0, 0, 1]);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // 不透明实体
    gl.depthMask(true);
    gl.useProgram(this.sceneProg);
    this.setSceneCommon();
    for (const obj of this.objects) {
      this.drawObject(this.sceneProg, obj);
    }

    // 影子 (半透明, 不写深度)
    gl.depthMask(false);
    gl.useProgram(this.shadowProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.shadowProg, 'uView'), false, this.view);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.shadowProg, 'uProj'), false, this.proj);
    for (const obj of this.shadowObjects) {
      if (obj.alpha <= 0) continue;
      gl.uniformMatrix4fv(gl.getUniformLocation(this.shadowProg, 'uModel'), false, obj.model);
      gl.uniform4f(
        gl.getUniformLocation(this.shadowProg, 'uColor'),
        obj.color[0],
        obj.color[1],
        obj.color[2],
        obj.alpha,
      );
      this.drawMesh(obj.mesh);
    }
    gl.depthMask(true);
  }

  private setSceneCommon(): void {
    const gl = this.gl;
    gl.uniformMatrix4fv(gl.getUniformLocation(this.sceneProg, 'uView'), false, this.view);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.sceneProg, 'uProj'), false, this.proj);
    gl.uniform3fv(gl.getUniformLocation(this.sceneProg, 'uSunDir'), this.sunDir);
  }

  private drawObject(prog: WebGLProgram, obj: RenderObject): void {
    const gl = this.gl;
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uModel'), false, obj.model);
    gl.uniform3f(
      gl.getUniformLocation(prog, 'uColor'),
      obj.color[0],
      obj.color[1],
      obj.color[2],
    );
    if (prog === this.sceneProg) {
      gl.uniform1f(gl.getUniformLocation(prog, 'uAlpha'), obj.alpha);
      gl.uniform1i(gl.getUniformLocation(prog, 'uUnlit'), obj.unlit ? 1 : 0);
    }
    this.drawMesh(obj.mesh);
  }

  private drawMesh(mesh: GPUMesh): void {
    const gl = this.gl;
    gl.bindVertexArray(mesh.vao);
    if (mesh.indexCount > 0) gl.drawElements(mesh.mode, mesh.indexCount, gl.UNSIGNED_INT, 0);
    else gl.drawArrays(mesh.mode, 0, mesh.vertexCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}

// ----------------------------------------------------------------- 几何辅助
function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function toVec3(v: vec3): Vec3 {
  return { x: v[0], y: v[1], z: v[2] };
}

/** 圆盘 (中心在原点, 法向 n), 三角扇 */
function buildPlateMesh(radius: number, n: Vec3, segments: number): TriangleMesh {
  const helper = Math.abs(n.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const e1 = norm(cross3(n, helper));
  const e2 = norm(cross3(n, e1));
  const positions: Vec3[] = [{ x: 0, y: 0, z: 0 }];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    positions.push(add(scale(e1, Math.cos(a) * radius), scale(e2, Math.sin(a) * radius)));
  }
  const indices: number[] = [];
  for (let i = 1; i <= segments; i++) indices.push(0, i, i + 1);
  return { positions, indices };
}

/** 墙面背板 */
function buildBackingMesh(size: number, n: Vec3, offset: number): TriangleMesh {
  const helper = Math.abs(n.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const e1 = norm(cross3(n, helper));
  const e2 = norm(cross3(n, e1));
  const c = scale(n, offset);
  const h = size / 2;
  const positions = [
    add(c, add(scale(e1, -h), scale(e2, -h))),
    add(c, add(scale(e1, h), scale(e2, -h))),
    add(c, add(scale(e1, h), scale(e2, h))),
    add(c, add(scale(e1, -h), scale(e2, h))),
  ];
  return { positions, indices: [0, 1, 2, 0, 2, 3] };
}

/** 地平参考网格 */
function buildGroundMesh(extent: number): TriangleMesh {
  const positions: Vec3[] = [];
  const n = 6;
  for (let i = -n; i <= n; i++) {
    const t = (i / n) * extent;
    positions.push({ x: t, y: -extent, z: 0 }, { x: t, y: extent, z: 0 });
    positions.push({ x: -extent, y: t, z: 0 }, { x: extent, y: t, z: 0 });
  }
  return { positions, indices: [] };
}

/**
 * 把三角形网格沿太阳方向平行投影到法向 n 的平面 (过原点)。
 * P' = P - (P·n)/(s·n) · s
 */
function projectMeshToPlane(mesh: TriangleMesh, sun: Vec3, n: Vec3): TriangleMesh {
  const sn = dot(sun, n);
  if (Math.abs(sn) < 1e-6) return { positions: [], indices: [] };
  const positions = mesh.positions.map((p) => {
    const lambda = dot(p, n) / sn;
    const projected = sub(p, scale(sun, lambda));
    return projectOnPlane(projected, n); // 数值上贴平
  });
  return { positions, indices: [...mesh.indices] };
}

export type { Vec2 };
