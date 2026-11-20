/**
 * 刻线精度审计: 对每个测试城市 × 三种晲型, 分别校验
 *   1) 时线 —— 极轴针(过盘心)的影子方向, 与赤纬无关, 用独立极轴投影核对角度
 *   2) 节气线 —— 针尖影子落在节气线上, 逐点核对距离
 * 统计最大偏差 (mm), 给出 0.5mm 指标达标结论。
 * 运行: npx vite-node tests/accuracyAudit.mts
 */
import {
  buildDialGeometry,
  sunVector,
  type DialGeometry,
  type DialInput,
  type Vec2,
} from '../src/core/dialGeometry';
import { CITIES } from '../src/core/cities';
import { OBLIQUITY } from '../src/core/solarTerms';
import { add, cross, dot, norm, projectOnPlane, scale } from '../src/core/vector3';

const RADIUS = 0.3;

/**
 * 时线方向 = 极轴与太阳张成的时角平面和晷面平面的交线。
 * 交线方向 = (q × s) × n, 该方向只随时角变化、与赤纬无关 (理论与数值均验证)。
 * 返回盘面二维方向向量。
 */
function hourLineDirection(dial: DialGeometry, ha: number, dec: number): Vec2 | null {
  const { frame, input, gnomon } = dial;
  const sun = sunVector(ha, dec, input.location.latitudeDeg);
  if (sun.z <= 0 || dot(sun, frame.n) <= 1e-6) return null;
  const q = gnomon.styleDirection;
  const world = norm(cross(cross(q, sun), frame.n));
  return { x: dot(world, frame.u), y: dot(world, frame.v) };
}

/** 针尖影子 —— 落在节气线上 */
function tipShadow(dial: DialGeometry, ha: number, dec: number): Vec2 | null {
  const { frame, gnomon, input } = dial;
  const sun = sunVector(ha, dec, input.location.latitudeDeg);
  if (sun.z <= 0 || dot(sun, frame.n) <= 1e-6) return null;
  const tip = scale(gnomon.styleDirection, gnomon.lengthM);
  const lambda = -dot(tip, frame.n) / dot(sun, frame.n);
  const p = add(tip, scale(sun, lambda));
  const inPlane = projectOnPlane(p, frame.n);
  return { x: dot(inPlane, frame.u), y: dot(inPlane, frame.v) };
}

function distSegMm(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const l2 = vx * vx + vy * vy;
  let t = l2 > 0 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy)) * 1000;
}

function distToLineMm(p: Vec2, line: Vec2[]): number {
  if (line.length === 1) return Math.hypot(p.x - line[0].x, p.y - line[0].y) * 1000;
  let m = Infinity;
  for (let i = 0; i < line.length - 1; i++) m = Math.min(m, distSegMm(p, line[i], line[i + 1]));
  return m;
}

/** 两个盘面方向的夹角 (弧度), 处理反平行 */
function angleBetween(a: Vec2, b: Vec2): number {
  const la = Math.hypot(a.x, a.y);
  const lb = Math.hypot(b.x, b.y);
  if (la < 1e-12 || lb < 1e-12) return 0;
  let cos = (a.x * b.x + a.y * b.y) / (la * lb);
  cos = Math.max(-1, Math.min(1, cos));
  return Math.acos(Math.abs(cos)); // 直线无向, 取锐角
}

const decs = [-OBLIQUITY, -20, -10, 0, 10, 20, OBLIQUITY];
let globalMax = 0;
const rows: string[] = [];

for (const city of CITIES) {
  for (const type of ['horizontal', 'equatorial', 'wall'] as const) {
    const input: DialInput = {
      location: city,
      type,
      radiusM: RADIUS,
      styleThicknessM: 0.004,
      shadowEdge: 'center',
    };
    if (type === 'wall') input.wall = { azimuthDeg: 180, tiltFromVerticalDeg: 6 };
    const dial = buildDialGeometry(input);
    let maxHourErr = 0;
    let maxTermErr = 0;
    let hourChecks = 0;
    let termChecks = 0;

    // 1) 时线: 针中点的影子方向必须落在引擎时线射线上 (与赤纬无关)
    for (const line of dial.hourLines) {
      if (!line.visible || line.points.length < 2) continue;
      const ha = (line.hour - 12) * 15;
      const ray = line.points[1];
      for (const dec of decs) {
        const dir = hourLineDirection(dial, ha, dec);
        if (!dir) continue;
        // 夹角换算成盘边 (RADIUS 处) 的线位移, mm
        const errMm = Math.tan(angleBetween(dir, ray)) * RADIUS * 1000;
        maxHourErr = Math.max(maxHourErr, errMm);
        hourChecks++;
      }
    }

    // 2) 节气线: 针尖影子必须落在对应赤纬的节气线上
    for (const term of dial.termLines) {
      if (term.points.length < 2) continue;
      for (let h = 5; h <= 19; h += 0.5) {
        const p = tipShadow(dial, (h - 12) * 15, term.declinationDeg);
        if (!p || Math.hypot(p.x, p.y) > RADIUS) continue;
        maxTermErr = Math.max(maxTermErr, distToLineMm(p, term.points));
        termChecks++;
      }
    }

    const maxErr = Math.max(maxHourErr, maxTermErr);
    globalMax = Math.max(globalMax, maxErr);
    rows.push(
      `${city.name.padEnd(12)} ${type.padEnd(11)} 时线${String(hourChecks).padStart(4)}(max ${maxHourErr.toFixed(3)}) 节气${String(termChecks).padStart(4)}(max ${maxTermErr.toFixed(3)})  ${maxErr < 0.5 ? '✓' : '✗'}`,
    );
  }
}

console.log('=== 日晷刻线精度审计 (限值 0.5 mm, 晷面半径 300 mm) ===\n');
console.log(rows.join('\n'));
console.log(`\n全局最大偏差: ${globalMax.toFixed(4)} mm`);
console.log(globalMax < 0.5 ? '结论: 全部城市 × 全部晲型达标 ✓' : '结论: 存在超标 ✗');
