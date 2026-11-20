/**
 * 三维向量与基础数学工具。
 * 全部使用本地 ENU 站心坐标系: X=东, Y=北, Z=天顶。
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const add = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});

export const sub = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

export const scale = (a: Vec3, s: number): Vec3 => ({
  x: a.x * s,
  y: a.y * s,
  z: a.z * s,
});

export const dot = (a: Vec3, b: Vec3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const length = (a: Vec3): number => Math.sqrt(dot(a, a));

export const norm = (a: Vec3): Vec3 => {
  const l = length(a);
  if (l < 1e-15) throw new Error('norm: 零向量无法归一化');
  return scale(a, 1 / l);
};

export const neg = (a: Vec3): Vec3 => ({ x: -a.x, y: -a.y, z: -a.z });

export const eq = (a: Vec3, b: Vec3, eps = 1e-12): boolean =>
  length(sub(a, b)) <= eps;

export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
  add(a, scale(sub(b, a), t));

/** 将向量 v 投影到单位法向量 n 所在的平面, 返回平面内分量 */
export const projectOnPlane = (v: Vec3, n: Vec3): Vec3 =>
  sub(v, scale(n, dot(v, n)));

/** v 在由单位向量 u 张成的轴上的有向夹角(弧度), 范围 (-PI, PI] */
export const signedAngle = (v: Vec3, u: Vec3): number => {
  const c = clamp(dot(v, u), -1, 1);
  return Math.acos(c);
};

export const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));

/** 将角度归一化到 [0, 360) */
export const wrap360 = (deg: number): number => {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
};

/** 将角度归一化到 (-180, 180] */
export const wrap180 = (deg: number): number => {
  let d = wrap360(deg);
  if (d > 180) d -= 360;
  return d;
};

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const TAU = 2 * Math.PI;

/** 解一元二次方程 a t^2 + b t + c = 0, 返回实数根(升序) */
export const solveQuadratic = (a: number, b: number, c: number): number[] => {
  if (Math.abs(a) < 1e-18) {
    if (Math.abs(b) < 1e-18) return [];
    return [-c / b];
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  if (disc === 0) return [-b / (2 * a)];
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  return [Math.min(t1, t2), Math.max(t1, t2)];
};
