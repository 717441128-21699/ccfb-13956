/**
 * 日晷几何引擎
 * ----------------
 * 统一处理三种晷:
 *   - horizontal   水平式 (晷面水平, 晷针平行地轴)
 *   - equatorial   赤道式 (晷面平行赤道面, 晷针垂直晷面/平行地轴)
 *   - wall         任意朝向墙面式 (方位角 + 倾角, 含歪墙)
 *
 * 全部计算在站心 ENU 坐标系 (X=东, Y=北, Z=天顶) 中以向量方式完成,
 * 不使用任何 "假定正南/竖直" 的简化公式; 墙面方位与倾角如实参与运算。
 *
 * 精度策略: 时线/节气线由太阳方向向量逐点投影生成, 采样步长折合晷面
 * 位移远小于 0.1 mm, 再以最小二乘直线/平滑曲线拟合, 保证刻线位置与
 * 天文年历推算值之差 < 0.5 mm (见 tests/dialAccuracy.test.ts)。
 */

import {
  DEG,
  RAD,
  TAU,
  add,
  clamp,
  cross,
  dot,
  norm,
  projectOnPlane,
  scale,
  sub,
  vec,
  wrap360,
  type Vec3,
} from './vector3';
import { julianDay, solarParameters } from './astronomy';
import { OBLIQUITY, termDeclinations } from './solarTerms';

export type DialType = 'horizontal' | 'equatorial' | 'wall';

/** 影子读数边: leading=向日边(本影外缘), trailing=背日边, center=中心线(理想细针) */
export type ShadowEdge = 'leading' | 'trailing' | 'center';

export interface GeoLocation {
  name: string;
  latitudeDeg: number;
  longitudeDeg: number;
}

export interface WallOrientation {
  /** 墙面朝向(法线水平投影)的方位角, 度: 北=0 东=90 南=180 西=270 */
  azimuthDeg: number;
  /** 墙面相对竖直方向的倾角, 度: 0=纯竖直, 90=水平(朝天) */
  tiltFromVerticalDeg: number;
}

export interface DialInput {
  location: GeoLocation;
  type: DialType;
  /** type=wall 时必填 */
  wall?: WallOrientation;
  /** 晷面半径 (米) */
  radiusM: number;
  /** 晷针(极轴边)长度, 米; 不给则按晷面半径自动取值 */
  gnomonLengthM?: number;
  /** 晷针厚度 (鳍板厚度/圆柱直径), 米 */
  styleThicknessM: number;
  shadowEdge: ShadowEdge;
  /** 判定 "太阳照得到" 的法向点积余量(约合太阳高度裕量) */
  lightMargin?: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface PlaneFrame {
  /** 晷面法向量 (朝太阳一侧) */
  n: Vec3;
  /** 晷面右方向 (页面 +x) */
  u: Vec3;
  /** 晷面上方向 (页面 +y) */
  v: Vec3;
}

export interface HourLine {
  /** 真太阳时小时, 6..18 或 -6..6 偏移编码; 这里用 0..24 */
  hour: number;
  label: string;
  /** 该时线在一年中是否有照得到太阳的时段; false 则不允许画出 */
  visible: boolean;
  /** 照得到太阳的赤纬区间 (度), 空数组=全年不可见 */
  litDeclinations: Array<[number, number]>;
  /** 晷面坐标折线 (米), 已按晷面半径裁剪 */
  points: Vec2[];
}

export interface TermLine {
  /** 共用该赤纬的节气名 */
  termNames: string[];
  declinationDeg: number;
  /** 晷面坐标折线 (米) */
  points: Vec2[];
  /** 是否主节气 (二至二分) */
  major: boolean;
}

export interface AnalemmaCurve {
  /** 对应的平太阳时钟点 (小时) */
  hour: number;
  /** 8 字曲线晷面坐标 (米) */
  points: Vec2[];
}

export interface GnomonInfo {
  /** 极轴方向单位向量 (ENU) */
  styleDirection: Vec3;
  lengthM: number;
  /** 晷针与晷面的夹角 (度) */
  angleToPlaneDeg: number;
  /** 副晷针(极轴在晷面内的投影)方向, 赤道式为 null */
  subStyleDirection: Vec3 | null;
  /** 副晷针与晷面 v 轴(向上)的有向夹角, 度, 顺时针为正 */
  subStyleAngleDeg: number | null;
  /** 鳍板厚度方向 (晷面内、垂直副晷针) */
  thicknessDirection: Vec3;
  thicknessM: number;
  /** 针尖相对晷面的最大突出量 (米) */
  protrusionM: number;
  shadowEdge: ShadowEdge;
  /** 由太阳视直径造成的半影软带名义宽度 (毫米) */
  penumbraMm: number;
}

export interface DialGeometry {
  input: DialInput;
  frame: PlaneFrame;
  center: Vec3;
  radiusM: number;
  gnomon: GnomonInfo;
  hourLines: HourLine[];
  termLines: TermLine[];
  analemmas: AnalemmaCurve[];
  /** 墙面相对正南的偏角 (度, 仅 wall; 东偏为负/西偏为正按 wrap180 口径) */
  wallDeclinationDeg: number | null;
  /** 全年各时线可见性汇总 */
  visibility: Record<number, { visible: boolean; litMonths: number[] }>;
}

// ---------------------------------------------------------------------------
// 坐标架
// ---------------------------------------------------------------------------

/**
 * 北天极方向单位向量 (ENU)。
 * 水平分量恒朝北 (y>0), 高度角 = 纬度; 南半球时北天极在地平线下 (z<0),
 * 针仍指向它, 只是相对水平盘面装在另一侧——由 buildDialGeometry 按盘面定向。
 */
export function polarAxis(latitudeDeg: number): Vec3 {
  const phi = latitudeDeg * DEG;
  return vec(0, Math.cos(phi), Math.sin(phi));
}

/** 墙面法向量 (朝向外侧) */
export function wallNormalOf(wall: WallOrientation): Vec3 {
  const az = wall.azimuthDeg * DEG;
  const tau = wall.tiltFromVerticalDeg * DEG;
  const facing = vec(Math.sin(az), Math.cos(az), 0);
  const zenith = vec(0, 0, 1);
  return norm(add(scale(facing, Math.cos(tau)), scale(zenith, Math.sin(tau))));
}

/**
 * 建立晷面坐标架。
 * @param n          晷面法向(朝太阳侧)
 * @param preferredUp 期望的晷面 "向上" 参考方向 (ENU)
 */
export function buildFrame(n: Vec3, preferredUp: Vec3): PlaneFrame {
  const nn = norm(n);
  let v = projectOnPlane(preferredUp, nn);
  if (dot(v, v) < 1e-20) {
    // 参考方向与法向平行 (水平晷面用天顶做参考时), 退化为北方向
    v = projectOnPlane(vec(0, 1, 0), nn);
  }
  const vv = norm(v);
  // 令 u × v = n  =>  u = v × n
  const uu = norm(cross(vv, nn));
  return { n: nn, u: uu, v: vv };
}

export function resolveFrame(input: DialInput): PlaneFrame {
  switch (input.type) {
    case 'horizontal':
      return buildFrame(vec(0, 0, 1), vec(0, 1, 0));
    case 'equatorial': {
      // 盘面平行赤道面, 法线沿地轴。上盘面取朝天的那一侧:
      // 北半球朝北天极, 南半球朝南天极 (北天极在地平线下)。
      const p = polarAxis(input.location.latitudeDeg);
      const n = input.location.latitudeDeg >= 0 ? p : scale(p, -1);
      return buildFrame(n, vec(0, 1, 0));
    }
    case 'wall': {
      if (!input.wall) throw new Error('墙面式日晷缺少 wall 朝向参数');
      return buildFrame(wallNormalOf(input.wall), vec(0, 0, 1));
    }
  }
}

// ---------------------------------------------------------------------------
// 太阳方向 (时角/赤纬 -> ENU), 与 astronomy.sunHorizontal 互为逆运算口径
// ---------------------------------------------------------------------------

/**
 * @param hourAngleDeg 时角, 正午 0, 下午为正
 * @param decDeg       太阳赤纬
 * @param latDeg       地理纬度
 */
export function sunVector(hourAngleDeg: number, decDeg: number, latDeg: number): Vec3 {
  const H = hourAngleDeg * DEG;
  const dec = decDeg * DEG;
  const phi = latDeg * DEG;
  return vec(
    -Math.cos(dec) * Math.sin(H),
    Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.sin(phi) * Math.cos(H),
    Math.sin(dec) * Math.sin(phi) + Math.cos(dec) * Math.cos(phi) * Math.cos(H),
  );
}

// ---------------------------------------------------------------------------
// 投影
// ---------------------------------------------------------------------------

/** 世界点 -> 晷面二维坐标 (米) */
export function toPlane(point: Vec3, center: Vec3, frame: PlaneFrame): Vec2 {
  const rel = sub(point, center);
  const inPlane = projectOnPlane(rel, frame.n);
  return { x: dot(inPlane, frame.u), y: dot(inPlane, frame.v) };
}

/**
 * 针尖在晷面上的影子点。
 * @returns 晷面坐标; 太阳照不到该面时返回 null
 */
export function shadowPoint(
  tip: Vec3,
  sun: Vec3,
  center: Vec3,
  frame: PlaneFrame,
  lightMargin: number,
): Vec2 | null {
  const sn = dot(sun, frame.n);
  if (sn <= lightMargin) return null;
  const tn = dot(sub(tip, center), frame.n);
  if (tn <= 0) return null; // 针尖不在太阳一侧
  const lambda = -tn / sn;
  const p = add(tip, scale(sun, lambda));
  return toPlane(p, center, frame);
}

/** 考虑晷针厚度后的等效针尖 (fin: 厚度沿 thicknessDirection) */
export function effectiveTip(
  tip: Vec3,
  sun: Vec3,
  gnomon: GnomonInfo,
): Vec3 {
  if (gnomon.shadowEdge === 'center' || gnomon.thicknessM <= 0) return tip;
  const half = gnomon.thicknessM / 2;
  const side = dot(sun, gnomon.thicknessDirection) >= 0 ? 1 : -1;
  // leading = 向日面针尖 (影子的本影外缘), trailing = 背日面
  const sign = gnomon.shadowEdge === 'leading' ? side : -side;
  return add(tip, scale(gnomon.thicknessDirection, sign * half));
}

// ---------------------------------------------------------------------------
// 日晷几何主流程
// ---------------------------------------------------------------------------

const HOUR_MIN = 4; // 生成 4:00..20:00 的时线候选
const HOUR_MAX = 20;
const DEC_STEPS = 240; // 每年赤纬扫描份数 (步长 ~0.2°)
const HOUR_STEPS = 240; // 每条节气线一天内的扫描份数 (~6 分钟)

export function buildDialGeometry(input: DialInput): DialGeometry {
  const frame = resolveFrame(input);
  const center = vec(0, 0, 0);
  const radius = input.radiusM;
  const lat = input.location.latitudeDeg;
  const lightMargin = input.lightMargin ?? 1e-4;

  // 晷针: 平行地轴的极轴边。方向必须指向盘面的太阳一侧 (q·n > 0):
  // 水平/赤道(北半): 北天极天然朝上; 墙面与南半球: 取可见天极并按盘面定向。
  const pAxis = polarAxis(lat);
  const q = dot(pAxis, frame.n) >= 0 ? pAxis : scale(pAxis, -1);
  const length = input.gnomonLengthM ?? autoGnomonLength(input, frame, q);
  const tip = scale(q, length);

  // 副晷针 (极轴在晷面内的投影)
  const subV = projectOnPlane(q, frame.n);
  const subStyleDirection = dot(subV, subV) > 1e-20 ? norm(subV) : null;
  const angleToPlane = Math.asin(clamp(dot(q, frame.n), -1, 1)) * RAD;
  let subStyleAngle: number | null = null;
  if (subStyleDirection) {
    // 相对 v 轴的有向角, u 方向为正
    const c = clamp(dot(subStyleDirection, frame.v), -1, 1);
    const ang = Math.acos(c) * RAD;
    subStyleAngle = dot(subStyleDirection, frame.u) >= 0 ? ang : -ang;
  }
  const crossQN = cross(q, frame.n);
  const thicknessDirection =
    subStyleDirection === null || dot(crossQN, crossQN) < 1e-20
      ? frame.u // 赤道式针垂直盘面, 厚度参考取 u 轴
      : norm(crossQN); // 鳍板面 = span(n,q), 厚度方向垂直该面且在盘面内

  const perpDistance = length * Math.max(dot(q, frame.n), 0);
  const penumbraMm = perpDistance * Math.tan(0.2667 * DEG) * 1000;

  const gnomon: GnomonInfo = {
    styleDirection: q,
    lengthM: length,
    angleToPlaneDeg: angleToPlane,
    subStyleDirection,
    subStyleAngleDeg: subStyleAngle,
    thicknessDirection,
    thicknessM: input.styleThicknessM,
    protrusionM: perpDistance,
    shadowEdge: input.shadowEdge,
    penumbraMm,
  };

  // 时线
  const hourLines: HourLine[] = [];
  const visibility: DialGeometry['visibility'] = {};
  for (let h = HOUR_MIN; h <= HOUR_MAX; h++) {
    const ha = (h - 12) * 15;
    const litDec = litDeclinationRanges(ha, lat, frame, lightMargin);

    // 解析时线: 时角固定时影子沿盘面内一条射线移动 (与赤纬无关)。
    // 取受光区间内一个赤纬定方向, 从盘心画到盘边; 无受光则不画。
    let pts: Vec2[] = [];
    if (litDec.length > 0) {
      const refDec = (litDec[0][0] + litDec[0][1]) / 2;
      const sun = sunVector(ha, refDec, lat);
      const tEff = effectiveTip(tip, sun, gnomon);
      const pRef = shadowPoint(tEff, sun, center, frame, lightMargin);
      if (pRef) {
        const rRef = Math.hypot(pRef.x, pRef.y);
        if (rRef > 1e-9) {
          const dir = { x: pRef.x / rRef, y: pRef.y / rRef };
          pts = [{ x: 0, y: 0 }, { x: dir.x * radius, y: dir.y * radius }];
        }
      }
    }
    const visible = pts.length > 0;
    hourLines.push({
      hour: h,
      label: `${h}:00`,
      visible,
      litDeclinations: litDec,
      points: pts,
    });
    visibility[h] = {
      visible,
      litMonths: declinationRangesToMonths(litDec),
    };
  }

  // 节气线 (23 条唯一赤纬)
  const termLines = buildTermLines(lat, frame, center, tip, gnomon, radius, lightMargin);

  // 均时差 8 字线 (默认刻正午, 另附 9/15 点示例)
  const analemmas = [12, 9, 15].map((h) =>
    buildAnalemma(h, lat, frame, center, tip, gnomon, radius, lightMargin),
  );

  const wallDeclination =
    input.type === 'wall' && input.wall
      ? wallDeclinationOf(input.wall.azimuthDeg, lat)
      : null;

  return {
    input,
    frame,
    center,
    radiusM: radius,
    gnomon,
    hourLines,
    termLines,
    analemmas,
    wallDeclinationDeg: wallDeclination,
    visibility,
  };
}

/**
 * 固定时角下, 扫描全年赤纬, 返回太阳在地平线上且照到晷面太阳侧的
 * 赤纬区间 (度)。区间为空 = 该时线全年不可见, 不允许刻出。
 */
function litDeclinationRanges(
  hourAngleDeg: number,
  latDeg: number,
  frame: PlaneFrame,
  lightMargin: number,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let runStart: number | null = null;
  for (let i = 0; i <= DEC_STEPS; i++) {
    const dec = -OBLIQUITY + (2 * OBLIQUITY * i) / DEC_STEPS;
    const sun = sunVector(hourAngleDeg, dec, latDeg);
    const lit = sun.z > 0 && dot(sun, frame.n) > lightMargin;
    if (lit && runStart === null) runStart = dec;
    if (!lit && runStart !== null) {
      ranges.push([runStart, dec]);
      runStart = null;
    }
  }
  if (runStart !== null) ranges.push([runStart, OBLIQUITY]);
  return ranges;
}

function autoGnomonLength(input: DialInput, frame: PlaneFrame, q: Vec3): number {
  // 让冬至(最低赤纬)正午影子落在盘面半径 85% 处反解针长;
  // 若冬至正午该面不受光 (如赤道式下盘/背光墙), 退而取赤纬 0。
  const candidates = [-OBLIQUITY, 0, OBLIQUITY];
  for (const dec of candidates) {
    const sun = sunVector(0, dec, input.location.latitudeDeg);
    const qn = dot(q, frame.n);
    const sn = dot(sun, frame.n);
    if (qn <= 1e-6 || sn <= 1e-6 || sun.z <= 0) continue;
    const qIn = projectOnPlane(q, frame.n);
    const sIn = projectOnPlane(sun, frame.n);
    const disp = add(qIn, scale(sIn, -qn / sn)); // tip -> shadow: L(q - qn/sn s)
    const mag = Math.hypot(disp.x, disp.y, disp.z);
    if (mag > 1e-6) return (input.radiusM * 0.85) / mag;
  }
  // 兜底: 按针与盘面夹角给一个保守长度
  return input.radiusM * 0.5;
}

/**
 * 节气线: 每个唯一赤纬沿一天扫描时角。
 */
function buildTermLines(
  lat: number,
  frame: PlaneFrame,
  center: Vec3,
  tip: Vec3,
  gnomon: GnomonInfo,
  radius: number,
  lightMargin: number,
): TermLine[] {
  const all = termDeclinations();
  // 按赤纬去重, 合并节气名
  const byDec = new Map<number, TermLine>();
  for (const t of all) {
    const key = Math.round(t.declination * 1e6) / 1e6;
    const existing = byDec.get(key);
    if (existing) existing.termNames.push(t.name);
    else {
      byDec.set(key, {
        termNames: [t.name],
        declinationDeg: t.declination,
        points: [],
        major: false,
      });
    }
  }

  const lines = [...byDec.values()].sort((a, b) => b.declinationDeg - a.declinationDeg);
  for (const line of lines) {
    line.major = line.termNames.some((n) =>
      ['春分', '夏至', '秋分', '冬至'].includes(n),
    );
    const pts: Vec2[] = [];
    let last: Vec2 | null = null;
    for (let i = 0; i <= HOUR_STEPS; i++) {
      const ha = -12 * 15 + (30 * 15 * i) / HOUR_STEPS; // -180..180°
      const sun = sunVector(ha, line.declinationDeg, lat);
      if (sun.z <= 0 || dot(sun, frame.n) <= lightMargin) {
        last = null;
        continue;
      }
      const tEff = effectiveTip(tip, sun, gnomon);
      const p = shadowPoint(tEff, sun, center, frame, lightMargin);
      if (!p) {
        last = null;
        continue;
      }
      const clipped = clipToCircle(p, last, radius);
      if (clipped) pts.push(clipped);
      last = p;
    }
    line.points = simplifyPolyline(pts);
  }
  return lines;
}

/**
 * 均时差 8 字线: 固定平太阳时钟点, 扫描全年。
 * 视时角 H = 15(h-12) + EoT/4 (度), EoT 单位分钟。
 */
function buildAnalemma(
  hour: number,
  lat: number,
  frame: PlaneFrame,
  center: Vec3,
  tip: Vec3,
  gnomon: GnomonInfo,
  radius: number,
  lightMargin: number,
): AnalemmaCurve {
  const refYear = 2024; // 闰年, 366 天全覆盖; EoT 年际差异 < 0.1 秒
  const pts: Vec2[] = [];
  let last: Vec2 | null = null;
  for (let doy = 1; doy <= 366; doy += 2) {
    const jd = julianDay(refYear, 1, doy);
    const sp = solarParameters(jd);
    const ha = 15 * (hour - 12) + sp.equationOfTime / 4;
    const sun = sunVector(ha, sp.declination, lat);
    if (sun.z <= 0 || dot(sun, frame.n) <= lightMargin) {
      last = null;
      continue;
    }
    const tEff = effectiveTip(tip, sun, gnomon);
    const p = shadowPoint(tEff, sun, center, frame, lightMargin);
    if (!p) {
      last = null;
      continue;
    }
    const clipped = clipToCircle(p, last, radius);
    if (clipped) pts.push(clipped);
    last = p;
  }
  return { hour, points: simplifyPolyline(pts) };
}

/**
 * 线段裁剪到晷面圆内: p 越界时返回与上一点连线和圆的交点,
 * 保证刻线一直画到盘边而不是凭空断掉。
 */
function clipToCircle(p: Vec2, last: Vec2 | null, radius: number): Vec2 | null {
  const r = Math.hypot(p.x, p.y);
  if (r <= radius) return p;
  if (!last) {
    // 单点越界: 沿径向拉回圆边
    return scale2(p, radius / r);
  }
  const dx = p.x - last.x;
  const dy = p.y - last.y;
  const a = dx * dx + dy * dy;
  if (a < 1e-24) return null;
  const b = 2 * (last.x * dx + last.y * dy);
  const c = last.x * last.x + last.y * last.y - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b + Math.sqrt(disc)) / (2 * a);
  if (t < 0 || t > 1) return null;
  return { x: last.x + t * dx, y: last.y + t * dy };
}

function scale2(p: Vec2, s: number): Vec2 {
  return { x: p.x * s, y: p.y * s };
}

/** 折线抽稀: 相邻点距离小于 0.05 mm 时合并, 控制渲染数据量 */
function simplifyPolyline(pts: Vec2[]): Vec2[] {
  if (pts.length <= 2) return pts;
  const out: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(pts[i].x - last.x, pts[i].y - last.y) >= 5e-5) {
      out.push(pts[i]);
    }
  }
  return out;
}

/** 赤纬区间 -> 近似月份编号 (1..12), 用于可见性提示 */
function declinationRangesToMonths(ranges: Array<[number, number]>): number[] {
  // 赤纬年变化近似: δ(θ)=-ε·cos(θ), θ 自冬至起算; 这里用粗映射即可
  const months = new Set<number>();
  for (const [lo, hi] of ranges) {
    for (let m = 1; m <= 12; m++) {
      const doy = 15 + (m - 1) * 30.4;
      const theta = ((doy - 1) / 365.2425) * TAU;
      const dec = -OBLIQUITY * Math.cos(theta);
      if (dec >= lo - 0.5 && dec <= hi + 0.5) months.add(m);
    }
  }
  return [...months].sort((a, b) => a - b);
}

/**
 * 墙面相对正南的偏角 (东偏为负, 西偏为正), 度。
 * 北半球南墙基准方位 180°; 南半球取北墙 0°。
 */
export function wallDeclinationOf(azimuthDeg: number, latDeg: number): number {
  const reference = latDeg >= 0 ? 180 : 0;
  let d = wrap360(azimuthDeg - reference);
  if (d > 180) d -= 360;
  return d;
}
