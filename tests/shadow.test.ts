/**
 * 晷针粗细、影子边选择与照墙时段测试。
 */
import { describe, expect, it } from 'vitest';
import { buildDialGeometry, type DialInput } from '../src/core/dialGeometry';
import {
  computeShadow,
  styleShadowPolyline,
  SUN_ANGULAR_RADIUS_DEG,
  readHourAngle,
  buildFinMesh,
  buildRodMesh,
} from '../src/core/shadow';
import { wallLitIntervals, julianDay, sunHorizontal } from '../src/core/astronomy';
import { CITIES } from '../src/core/cities';
import { DEG, dot } from '../src/core/vector3';
import { sunVector } from '../src/core/dialGeometry';

const RADIUS = 0.3;
const beijing = CITIES[0];

function input(overrides: Partial<DialInput> = {}): DialInput {
  return {
    location: CITIES[0],
    type: 'horizontal',
    radiusM: RADIUS,
    styleThicknessM: 0.006,
    shadowEdge: 'center',
    ...overrides,
  };
}

describe('影子读数边选择', () => {
  const center = buildDialGeometry(input({ shadowEdge: 'center' }));
  const leading = buildDialGeometry(input({ shadowEdge: 'leading' }));
  const trailing = buildDialGeometry(input({ shadowEdge: 'trailing' }));
  // 2024-06-21 北京下午 3 点 (UTC 07:00)
  const date = new Date(Date.UTC(2024, 5, 21, 7, 0, 0));

  it('leading / trailing 影子点分居中心线两侧, 间距等于针厚投影', () => {
    const sc = computeShadow(center, date);
    const sl = computeShadow(leading, date);
    const st = computeShadow(trailing, date);
    expect(sc.readingPoint).not.toBeNull();
    expect(sl.readingPoint).not.toBeNull();
    expect(st.readingPoint).not.toBeNull();

    const dl = Math.hypot(sl.readingPoint!.x - sc.readingPoint!.x, sl.readingPoint!.y - sc.readingPoint!.y);
    const dt = Math.hypot(st.readingPoint!.x - sc.readingPoint!.x, st.readingPoint!.y - sc.readingPoint!.y);
    // 针半径 3mm, 盘面处影子边相对中心偏移 ≈ 3mm (水平针近竖直时投影约 1:1)
    expect(dl).toBeGreaterThan(0.0015);
    expect(dt).toBeGreaterThan(0.0015);
    expect(Math.abs(dl - dt)).toBeLessThan(0.001);
  });

  it('leading 与 trailing 点在中心线相反方向', () => {
    const sc = computeShadow(center, date);
    const sl = computeShadow(leading, date);
    const st = computeShadow(trailing, date);
    const vl = { x: sl.readingPoint!.x - sc.readingPoint!.x, y: sl.readingPoint!.y - sc.readingPoint!.y };
    const vt = { x: st.readingPoint!.x - sc.readingPoint!.x, y: st.readingPoint!.y - sc.readingPoint!.y };
    const d = vl.x * vt.x + vl.y * vt.y;
    expect(d).toBeLessThan(0);
  });

  it('半影宽度 > 针厚 (太阳视直径贡献软边)', () => {
    const s = computeShadow(center, date);
    expect(s.penumbraWidthMm).toBeGreaterThan(6);
    // 软带量级: 6mm 针 + 2·d·tan(0.2667°), d≈0.2m 时约 +1.9mm
    const expectedSoft = 2 * center.gnomon.protrusionM * Math.tan(SUN_ANGULAR_RADIUS_DEG * DEG) * 1000;
    expect(s.penumbraWidthMm).toBeCloseTo(6 + expectedSoft, 0.5);
  });
});

describe('墙面受光时段', () => {
  const beijing = CITIES[0];

  it('正南墙: 受光时段围绕太阳正午 (竖直墙受光时长与昼长相反, 冬长夏短)', () => {
    const jdWinter = julianDay(2024, 12, 21, 0);
    const jdSummer = julianDay(2024, 6, 21, 0);
    const south = { x: 0, y: -1, z: 0 };
    const winter = wallLitIntervals(jdWinter, beijing.longitudeDeg, beijing.latitudeDeg, south);
    const summer = wallLitIntervals(jdSummer, beijing.longitudeDeg, beijing.latitudeDeg, south);
    expect(winter.length).toBeGreaterThanOrEqual(1);
    expect(summer.length).toBeGreaterThanOrEqual(1);
    const len = (iv: Array<[number, number]>) => iv.reduce((acc, [a, b]) => acc + (b - a), 0);
    // 太阳高度角越低对竖直墙越有利: 冬至墙累计受光比夏至久
    expect(len(winter)).toBeGreaterThan(len(summer));
    // 北京真太阳正午 ≈ UTC 4:14 (120°E 正午为 UTC 4:00), 冬至该时刻南墙必受光
    const noonUtc = 12 - beijing.longitudeDeg / 15;
    const noonIv = wallLitIntervals(jdWinter, beijing.longitudeDeg, beijing.latitudeDeg, south, 15);
    const noonLit = noonIv.some(([lo, hi]) => noonUtc >= lo && noonUtc <= hi);
    expect(noonLit).toBe(true);
  });

  it('东南墙: 受光区间整体偏上午 (本地时)', () => {
    const jd = julianDay(2024, 3, 20, 0);
    const az = 135 * DEG;
    const normal = { x: Math.sin(az), y: Math.cos(az), z: 0 };
    const iv = wallLitIntervals(jd, beijing.longitudeDeg, beijing.latitudeDeg, normal);
    expect(iv.length).toBeGreaterThanOrEqual(1);
    const tzOffset = beijing.longitudeDeg / 15; // UTC -> 本地太阳时
    // 每段中点折算本地时都在正午前
    for (const [lo, hi] of iv) {
      const midLocal = (lo + hi) / 2 + tzOffset;
      const wrapped = ((midLocal % 24) + 24) % 24;
      // 跨午夜的深夜段折算后是清晨, 允许落在 0-12 或 23-24
      expect(wrapped < 12 || wrapped > 22).toBe(true);
    }
  });

  it('北墙: 北京正午时段无受光 (仅夏至日出后两小时内可能斜照)', () => {
    for (const doy of [1, 80, 172, 264, 355]) {
      const jd = julianDay(2024, 1, doy);
      const iv = wallLitIntervals(jd, beijing.longitudeDeg, beijing.latitudeDeg, { x: 0, y: 1, z: 0 });
      const meaningful = iv.filter(([lo, hi]) => hi - lo > 0.5); // 忽略折射阈值伪区间
      for (const [lo, hi] of meaningful) {
        // 真实受光区间整体在正午之前或之后, 绝不覆盖 12 点
        expect(hi <= 12 || lo >= 12).toBe(true);
      }
    }
    // 直接验证: 夏至正午太阳在正南, 与北墙法向点积为负
    const jdSol = julianDay(2024, 6, 21, 0);
    const iv = wallLitIntervals(jdSol, beijing.longitudeDeg, beijing.latitudeDeg, { x: 0, y: 1, z: 0 });
    expect(iv.every(([lo, hi]) => hi <= 12 || lo >= 12)).toBe(true);
  });

  it('墙法向与太阳方向点积符号和引擎可见性一致', () => {
    const dial = buildDialGeometry(
      input({
        type: 'wall',
        wall: { azimuthDeg: 220, tiltFromVerticalDeg: 5 },
      }),
    );
    const jd = julianDay(2024, 7, 1, 0);
    const intervals = wallLitIntervals(
      jd,
      beijing.longitudeDeg,
      beijing.latitudeDeg,
      dial.frame.n,
    );
    expect(intervals.length).toBeGreaterThan(0);
    // 区间内任意时刻点积为正
    const t = (intervals[0][0] + intervals[0][1]) / 2;
    const s = sunHorizontal(jd + t / 24, beijing.longitudeDeg, beijing.latitudeDeg);
    expect(dot(s.direction, dial.frame.n)).toBeGreaterThan(0);
  });
});

describe('影子反读 (影子位置 -> 时角)', () => {
  const dial = buildDialGeometry(input({}));
  it('已知影子点反求时角误差 < 0.05° (≈12 秒时间)', () => {
    for (const ha of [-60, -30, 0, 30, 60]) {
      // 纯几何往返: 固定赤纬 0 (春分), 由时角正算影子点, 再反读时角
      const sun = sunVector(ha, 0, beijing.latitudeDeg);
      const tip = {
        x: dial.gnomon.styleDirection.x * dial.gnomon.lengthM,
        y: dial.gnomon.styleDirection.y * dial.gnomon.lengthM,
        z: dial.gnomon.styleDirection.z * dial.gnomon.lengthM,
      };
      const lambda = -dot(tip, dial.frame.n) / dot(sun, dial.frame.n);
      const p3 = {
        x: tip.x + lambda * sun.x,
        y: tip.y + lambda * sun.y,
        z: tip.z + lambda * sun.z,
      };
      const p2 = {
        x: p3.x * dial.frame.u.x + p3.y * dial.frame.u.y + p3.z * dial.frame.u.z,
        y: p3.x * dial.frame.v.x + p3.y * dial.frame.v.y + p3.z * dial.frame.v.z,
      };
      const back = readHourAngle(dial, p2, 0);
      expect(back).not.toBeNull();
      expect(Math.abs(back! - ha)).toBeLessThan(0.05);
    }
  });
});

describe('晷针网格', () => {
  it('鳍板网格索引合法且有厚度', () => {
    const dial = buildDialGeometry(input({}));
    const mesh = buildFinMesh(dial);
    expect(mesh.positions.length).toBe(6);
    for (const i of mesh.indices) expect(i).toBeGreaterThanOrEqual(0);
    expect(mesh.indices.length % 3).toBe(0);
  });

  it('圆柱杆网格闭合', () => {
    const dial = buildDialGeometry(input({ type: 'equatorial' }));
    const mesh = buildRodMesh(dial, 16);
    expect(mesh.indices.length % 3).toBe(0);
    for (const i of mesh.indices) expect(i).toBeLessThan(mesh.positions.length);
  });

  it('影子折线在太阳背对墙面时为空', () => {
    const dial = buildDialGeometry(
      input({ type: 'wall', wall: { azimuthDeg: 180, tiltFromVerticalDeg: 0 } }),
    );
    // 取一个与南墙法向点积为负 (照北墙) 的太阳方向
    const sunFromNorth = { x: 0, y: 0.9, z: 0.4 };
    expect(dot(sunFromNorth, dial.frame.n)).toBeLessThan(0);
    expect(styleShadowPolyline(dial, sunFromNorth, 'center').length).toBe(0);
  });
});
