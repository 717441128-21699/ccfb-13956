/**
 * 三维影子模拟
 * ------------
 * - 太阳视半径 0.2667° (角直径 32′ 均值), 本影/半影按几何光学计算。
 * - 晷针支持三角鳍板(fin)与圆柱杆(rod)两种实体, 用真实网格投影,
 *   不再把针当成零粗细的线段。
 * - 读数边可选 leading(向日边/本影外缘)、trailing(背日边)、center(中心线)。
 */

import { DEG, add, clamp, cross, dot, norm, scale, sub, vec, type Vec3 } from './vector3';
import { sunHorizontal, julianDayOfDate } from './astronomy';
import {
  effectiveTip,
  sunVector,
  toPlane,
  type DialGeometry,
  type PlaneFrame,
  type ShadowEdge,
  type Vec2,
} from './dialGeometry';

export const SUN_ANGULAR_RADIUS_DEG = 0.2667;

export interface TriangleMesh {
  positions: Vec3[];
  /** 每三个索引一个三角形 */
  indices: number[];
}

/** 三角鳍板: 位于 span(n, q) 平面内, 厚度沿 thicknessDirection */
export function buildFinMesh(dial: DialGeometry): TriangleMesh {
  const { gnomon, frame } = dial;
  const q = gnomon.styleDirection;
  const L = gnomon.lengthM;
  const t = gnomon.thicknessM / 2;
  const td = gnomon.thicknessDirection;
  const tip = scale(q, L);

  // 鳍板三角形: 盘面中心 O, 盘面内沿副晷针的脚跟 H, 针尖 T
  let heel: Vec3;
  if (gnomon.subStyleDirection) {
    heel = scale(gnomon.subStyleDirection, L);
  } else {
    // 赤道式: 针垂直盘面, 鳍板退化为细矩形由厚度方向展开
    heel = scale(frame.v, L * 0.0);
  }
  const o = vec(0, 0, 0);
  const face = (s: number): Vec3[] => [
    add(o, scale(td, s * t)),
    add(heel, scale(td, s * t)),
    add(tip, scale(td, s * t)),
  ];
  const fPlus = face(1);
  const fMinus = face(-1);
  const positions = [...fPlus, ...fMinus];
  // 两个三角面 + 侧边 (细厚度, 用三角形条带近似)
  const indices = [
    0, 1, 2, // +面
    5, 4, 3, // -面 (反向)
    0, 2, 5, 0, 5, 3, // 厚度侧边 1
    1, 4, 5, 1, 5, 2, // 厚度侧边 2
    0, 3, 4, 0, 4, 1, // 底边
  ];
  return { positions, indices };
}

/** 圆柱杆: 沿 q 方向, 直径 = thicknessM */
export function buildRodMesh(dial: DialGeometry, segments = 24): TriangleMesh {
  const q = dial.gnomon.styleDirection;
  const L = dial.gnomon.lengthM;
  const r = dial.gnomon.thicknessM / 2;
  // 取两个正交于 q 的单位向量
  const helper = Math.abs(q.z) < 0.9 ? vec(0, 0, 1) : vec(1, 0, 0);
  const e1 = norm(cross(q, helper));
  const e2 = norm(cross(q, e1));
  const positions: Vec3[] = [];
  const indices: number[] = [];
  for (const z of [0, L]) {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const ring = add(
        scale(q, z),
        add(scale(e1, Math.cos(a) * r), scale(e2, Math.sin(a) * r)),
      );
      positions.push(ring);
    }
  }
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    indices.push(i, j, segments + j, i, segments + j, segments + i);
  }
  // 两端盖
  const baseCenter = positions.length;
  positions.push(vec(0, 0, 0));
  const tipCenter = positions.length;
  positions.push(scale(q, L));
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    indices.push(baseCenter, j, i);
    indices.push(tipCenter, segments + i, segments + j);
  }
  return { positions, indices };
}

export interface ShadowState {
  /** 太阳 ENU 单位方向 */
  sun: Vec3;
  azimuthDeg: number;
  altitudeDeg: number;
  /** 太阳是否在墙面(晷面)太阳侧 */
  faceLit: boolean;
  /** 太阳是否在地平线上 */
  aboveHorizon: boolean;
  /** 选用读数边对应的针尖影子晷面坐标 */
  readingPoint: Vec2 | null;
  centerPoint: Vec2 | null;
  leadingPoint: Vec2 | null;
  trailingPoint: Vec2 | null;
  /** 半影软带在该影子点处的全宽 (毫米) */
  penumbraWidthMm: number;
  /** 本影半宽 (毫米), 0 表示本影退化为点 */
  umbraHalfWidthMm: number;
  /** 时刻的真太阳时 (小时) */
  solarTime: number;
}

/** 单点在晷面上的影子, 返回晷面坐标或 null */
function pointShadow(
  point: Vec3,
  sun: Vec3,
  frame: PlaneFrame,
  lightMargin: number,
): Vec2 | null {
  const sn = dot(sun, frame.n);
  if (sn <= lightMargin) return null;
  const pn = dot(point, frame.n);
  if (pn <= 0) return null;
  const lambda = -pn / sn;
  return toPlane(add(point, scale(sun, lambda)), vec(0, 0, 0), frame);
}

/**
 * 计算某一时刻的影子状态。
 * @param date UTC 时刻
 */
export function computeShadow(dial: DialGeometry, date: Date): ShadowState {
  const { longitudeDeg: lon, latitudeDeg: lat } = dial.input.location;
  const jd = julianDayOfDate(date);
  const hor = sunHorizontal(jd, lon, lat);
  const sun = hor.direction;
  const frame = dial.frame;
  const g = dial.gnomon;
  const lightMargin = dial.input.lightMargin ?? 1e-4;

  const aboveHorizon = hor.altitude > -0.833;
  const faceLit = dot(sun, frame.n) > lightMargin;

  const tip = scale(g.styleDirection, g.lengthM);
  const centerPoint = pointShadow(tip, sun, frame, lightMargin);
  const leadingPoint = pointShadow(
    effectiveTip(tip, sun, { ...g, shadowEdge: 'leading' }),
    sun,
    frame,
    lightMargin,
  );
  const trailingPoint = pointShadow(
    effectiveTip(tip, sun, { ...g, shadowEdge: 'trailing' }),
    sun,
    frame,
    lightMargin,
  );
  const readingPoint =
    dial.input.shadowEdge === 'leading'
      ? leadingPoint
      : dial.input.shadowEdge === 'trailing'
        ? trailingPoint
        : centerPoint;

  // 本影/半影: 针到盘面垂直距离 d, 针半径 r
  const d = g.protrusionM;
  const r = g.thicknessM / 2;
  const spread = d * Math.tan(SUN_ANGULAR_RADIUS_DEG * DEG);
  const penumbraWidthMm = 2 * (r + spread) * 1000;
  const umbraHalfWidthMm = Math.max(0, r - spread) * 1000;

  return {
    sun,
    azimuthDeg: hor.azimuth,
    altitudeDeg: hor.altitude,
    faceLit,
    aboveHorizon,
    readingPoint,
    centerPoint,
    leadingPoint,
    trailingPoint,
    penumbraWidthMm,
    umbraHalfWidthMm,
    solarTime: hor.solarTime,
  };
}

/**
 * 沿整条极轴针取 N 个采样点, 求各读数边在晷面上的影子折线
 * (用于三维场景中直接绘制影子的本影轮廓)。
 */
export function styleShadowPolyline(
  dial: DialGeometry,
  sun: Vec3,
  edge: ShadowEdge,
  samples = 48,
): Vec2[] {
  const frame = dial.frame;
  const g = dial.gnomon;
  const lightMargin = dial.input.lightMargin ?? 1e-4;
  if (dot(sun, frame.n) <= lightMargin) return [];
  const out: Vec2[] = [];
  const half = g.thicknessM / 2;
  for (let i = 0; i <= samples; i++) {
    const f = i / samples;
    const base = scale(g.styleDirection, g.lengthM * f);
    let p = base;
    if (edge !== 'center' && g.thicknessM > 0) {
      const side = dot(sun, g.thicknessDirection) >= 0 ? 1 : -1;
      const sign = edge === 'leading' ? side : -side;
      p = add(base, scale(g.thicknessDirection, sign * half));
    }
    const s = pointShadow(p, sun, frame, lightMargin);
    if (s) out.push(s);
  }
  return out;
}

/**
 * 反求: 给定影子读数点(晷面坐标)与太阳赤纬, 求时角(度)。
 * 用于把 "影子位置" 换算成读数时间, 与刻线交叉验证。
 * 在盘面内影子点 P = L·(q_in - (q·n)/(s·n)·s_in), 采用一维搜索+二分,
 * 对任意歪墙都稳健。
 */
export function readHourAngle(
  dial: DialGeometry,
  planePoint: Vec2,
  declinationDeg: number,
): number | null {
  const lat = dial.input.location.latitudeDeg;
  const frame = dial.frame;
  const g = dial.gnomon;
  const tip = scale(g.styleDirection, g.lengthM);
  const target = add(scale(frame.u, planePoint.x), scale(frame.v, planePoint.y));

  const evalAt = (ha: number): number => {
    const sun = sunVector(ha, declinationDeg, lat);
    if (dot(sun, frame.n) <= 1e-6) return Number.POSITIVE_INFINITY;
    const p = pointShadow(tip, sun, frame, 1e-6);
    if (!p) return Number.POSITIVE_INFINITY;
    const world = add(scale(frame.u, p.x), scale(frame.v, p.y));
    return dot(sub(world, target), sub(world, target));
  };

  // 粗扫 -179..179 找谷
  let bestHa = 0;
  let bestErr = Number.POSITIVE_INFINITY;
  for (let ha = -179; ha <= 179; ha += 2) {
    const e = evalAt(ha);
    if (e < bestErr) {
      bestErr = e;
      bestHa = ha;
    }
  }
  if (!Number.isFinite(bestErr)) return null;
  // 黄金二分细化到 0.001°
  let lo = bestHa - 2;
  let hi = bestHa + 2;
  for (let i = 0; i < 40; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (evalAt(m1) < evalAt(m2)) hi = m2;
    else lo = m1;
  }
  return clamp((lo + hi) / 2, -180, 180);
}
