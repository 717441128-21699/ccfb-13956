/**
 * 刻线精度测试 (核心指标: 任一根线偏差 < 0.5 mm)。
 *
 * 对照方法: 不调用引擎的成线函数, 直接从向量几何独立重算影子点,
 * 与 buildDialGeometry 输出的时线/节气线逐点比较。
 * 另用经典解析公式 (水平式 tanθ=sinφ·tanH、正南面墙 tanθ=cosφ·tanH)
 * 交叉验证时线方位角。
 */
import { describe, expect, it } from 'vitest';
import {
  buildDialGeometry,
  polarAxis,
  sunVector,
  wallNormalOf,
  type DialGeometry,
  type DialInput,
  type Vec2,
} from '../src/core/dialGeometry';
import { CITIES } from '../src/core/cities';
import { OBLIQUITY } from '../src/core/solarTerms';
import { DEG, add, cross, dot, norm, projectOnPlane, scale } from '../src/core/vector3';

const RADIUS = 0.3; // 300 mm 晷面
const TOL_MM = 0.5;

function baseInput(overrides: Partial<DialInput>): DialInput {
  return {
    location: CITIES[0], // 北京
    type: 'horizontal',
    radiusM: RADIUS,
    styleThicknessM: 0.004,
    shadowEdge: 'center',
    ...overrides,
  };
}

/** 独立重算: 针尖 T=Lq 在太阳 s 下的盘面影子 */
function independentShadow(
  dial: DialGeometry,
  hourAngleDeg: number,
  declinationDeg: number,
): Vec2 | null {
  const { frame, gnomon, input } = dial;
  const sun = sunVector(hourAngleDeg, declinationDeg, input.location.latitudeDeg);
  if (sun.z <= 0 || dot(sun, frame.n) <= 1e-6) return null;
  const tip = scale(gnomon.styleDirection, gnomon.lengthM);
  const lambda = -dot(tip, frame.n) / dot(sun, frame.n);
  const p = add(tip, scale(sun, lambda));
  const inPlane = projectOnPlane(p, frame.n);
  return {
    x: dot(inPlane, frame.u),
    y: dot(inPlane, frame.v),
  };
}

function distMm(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y) * 1000;
}

/** 圆周角差 (弧度), 归一化到 (-PI, PI] */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** 点到线段的最短距离 (mm) */
function distanceToSegmentMm(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = { x: a.x + t * vx, y: a.y + t * vy };
  return Math.hypot(p.x - q.x, p.y - q.y) * 1000;
}

/** 折线上距 p 最近的距离 (mm), 逐段计算 */
function distanceToPolylineMm(p: Vec2, line: Vec2[]): number {
  if (line.length === 1) return distMm(p, line[0]);
  let min = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    min = Math.min(min, distanceToSegmentMm(p, line[i], line[i + 1]));
  }
  return min;
}

describe('水平式日晷 — 时线角度解析公式交叉验证', () => {
  const dial = buildDialGeometry(baseInput({}));
  const phi = CITIES[0].latitudeDeg * DEG;

  it('正午 12 点时线沿 v 轴 (子线方向)', () => {
    const noon = dial.hourLines.find((l) => l.hour === 12)!;
    expect(noon.visible).toBe(true);
    for (const p of noon.points) {
      expect(Math.abs(p.x)).toBeLessThan(1e-9);
    }
  });

  it('各整点时线角 = atan2(sinφ·sinH, cosH) (水平式经典公式的全象限版)', () => {
    for (const line of dial.hourLines) {
      if (!line.visible || line.points.length < 2) continue;
      const H = (line.hour - 12) * 15 * DEG;
      // 经典式 tanθ = sinφ·tanH, 用 atan2 覆盖 6/18 点边界
      const expected = Math.atan2(Math.sin(phi) * Math.sin(H), Math.cos(H));
      const outer = line.points[1];
      // 时线角相对盘面 +y(子线/午线) 量起
      const actual = Math.atan2(outer.x, outer.y);
      expect(Math.abs(angleDiff(actual, expected))).toBeLessThan(0.002); // 0.11°
    }
  });
});

describe('水平式 — 逐点影子位置 0.5mm 精度', () => {
  const dial = buildDialGeometry(baseInput({}));
  const declinations = [-OBLIQUITY, -20, -10, 0, 10, 20, OBLIQUITY];

  it('每根可见时线上的独立影子点与刻线距离 < 0.5 mm', () => {
    for (const line of dial.hourLines) {
      if (!line.visible) continue;
      const ha = (line.hour - 12) * 15;
      for (const dec of declinations) {
        const p = independentShadow(dial, ha, dec);
        if (!p) continue;
        if (Math.hypot(p.x, p.y) > RADIUS) continue;
        const d = distanceToPolylineMm(p, line.points);
        expect(d).toBeLessThan(TOL_MM);
      }
    }
  });

  it('每条节气线上的独立影子点与刻线距离 < 0.5 mm', () => {
    for (const term of dial.termLines) {
      if (term.points.length < 2) continue;
      for (let h = 5; h <= 19; h += 0.5) {
        const p = independentShadow(dial, (h - 12) * 15, term.declinationDeg);
        if (!p || Math.hypot(p.x, p.y) > RADIUS) continue;
        const d = distanceToPolylineMm(p, term.points);
        expect(d).toBeLessThan(TOL_MM);
      }
    }
  });
});

describe('赤道式日晷 — 时线等分 15°', () => {
  const dial = buildDialGeometry(baseInput({ type: 'equatorial' }));

  it('针与盘面夹角 90°', () => {
    expect(dial.gnomon.angleToPlaneDeg).toBeCloseTo(90, 6);
  });

  it('上盘面时角连续的相邻时线夹角恒为 15° (跳过不可见小时造成的圆周缺口)', () => {
    const byHour = new Map<number, number>();
    for (const line of dial.hourLines) {
      if (!line.visible || line.points.length < 2) continue;
      const outer = line.points[1];
      byHour.set(line.hour, Math.atan2(outer.y, outer.x) * (180 / Math.PI));
    }
    expect(byHour.size).toBeGreaterThan(5);
    const hours = [...byHour.keys()].sort((a, b) => a - b);
    let checked = 0;
    for (let i = 1; i < hours.length; i++) {
      if (hours[i] - hours[i - 1] !== 1) continue; // 只比时角相邻的整点
      let d = byHour.get(hours[i])! - byHour.get(hours[i - 1])!;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      expect(Math.abs(d)).toBeCloseTo(15, 0.6);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('上盘面只在 δ>0 (春分到秋分) 受光', () => {
    const noon = dial.hourLines.find((l) => l.hour === 12)!;
    expect(noon.litDeclinations.length).toBeGreaterThan(0);
    for (const [, hi] of noon.litDeclinations) {
      expect(hi).toBeGreaterThan(0);
    }
  });
});

describe('正南竖直墙面式 — 解析公式 tanθ = cosφ·tanH', () => {
  const dial = buildDialGeometry(
    baseInput({
      type: 'wall',
      wall: { azimuthDeg: 180, tiltFromVerticalDeg: 0 },
    }),
  );
  const phi = CITIES[0].latitudeDeg * DEG;

  it('墙法向水平指向正南', () => {
    const n = wallNormalOf({ azimuthDeg: 180, tiltFromVerticalDeg: 0 });
    expect(n.y).toBeCloseTo(-1, 10);
    expect(Math.abs(n.x)).toBeLessThan(1e-12);
  });

  it('各时线角与解析公式一致 (正南墙经典式 tanθ = cosφ·tanH 的全象限版)', () => {
    for (const line of dial.hourLines) {
      if (!line.visible || line.points.length < 2) continue;
      const H = (line.hour - 12) * 15 * DEG;
      // 墙面午线朝 -y, 下午影子在 +x: θ = atan2(cosφ·sinH, -cosH)
      const expected = Math.atan2(Math.cos(phi) * Math.sin(H), -Math.cos(H));
      const outer = line.points[1];
      const actual = Math.atan2(outer.x, outer.y); // 相对 +y, 与 expected 同基准
      expect(Math.abs(angleDiff(actual, expected))).toBeLessThan(0.002);
    }
  });

  it('逐点影子 < 0.5 mm', () => {
    for (const line of dial.hourLines) {
      if (!line.visible) continue;
      const ha = (line.hour - 12) * 15;
      for (const dec of [-OBLIQUITY, 0, OBLIQUITY]) {
        const p = independentShadow(dial, ha, dec);
        if (!p || Math.hypot(p.x, p.y) > RADIUS) continue;
        expect(distanceToPolylineMm(p, line.points)).toBeLessThan(TOL_MM);
      }
    }
  });
});

describe('歪墙: 偏离正南的时线裁剪', () => {
  it('朝东 60° 的墙: 上午受光、15 点后无直射且不生成刻线', () => {
    const dial = buildDialGeometry(
      baseInput({
        type: 'wall',
        wall: { azimuthDeg: 120, tiltFromVerticalDeg: 0 },
      }),
    );
    const morning = dial.hourLines.filter((l) => l.hour <= 11 && l.visible);
    const lateAfternoon = dial.hourLines.filter((l) => l.hour >= 15 && l.visible);
    expect(morning.length).toBeGreaterThan(0);
    expect(lateAfternoon.length).toBe(0);
    // 不可见线必须没有刻线点
    for (const line of dial.hourLines) {
      if (!line.visible) expect(line.points.length).toBe(0);
    }
  });

  it('朝西 60° 的墙: 下午受光、上午 9 点前无直射', () => {
    const dial = buildDialGeometry(
      baseInput({
        type: 'wall',
        wall: { azimuthDeg: 240, tiltFromVerticalDeg: 0 },
      }),
    );
    const earlyMorning = dial.hourLines.filter((l) => l.hour <= 9 && l.visible);
    const afternoon = dial.hourLines.filter((l) => l.hour >= 14 && l.visible);
    expect(earlyMorning.length).toBe(0);
    expect(afternoon.length).toBeGreaterThan(0);
  });

  it('北墙 (北半球): 正午前后无直射, 仅夏至日出/日没斜照时段可能有光', () => {
    const dial = buildDialGeometry(
      baseInput({
        type: 'wall',
        wall: { azimuthDeg: 0, tiltFromVerticalDeg: 0 },
      }),
    );
    // 9:00-15:00 太阳始终在南侧, 北墙正午时段绝无受光
    for (const h of [9, 10, 11, 12, 13, 14, 15]) {
      expect(dial.hourLines.find((l) => l.hour === h)!.visible).toBe(false);
    }
    // 受光时刻只能贴着日出/日没 (9 点前或 15 点后), 且赤纬下界不低于 0
    for (const line of dial.hourLines) {
      if (line.visible) {
        expect(line.hour < 9 || line.hour > 15).toBe(true);
        for (const [lo] of line.litDeclinations) expect(lo).toBeGreaterThanOrEqual(-0.5);
      } else {
        expect(line.points.length).toBe(0);
      }
    }
  });

  it('倾斜 10° 的南墙按实际倾角计算, 与竖直墙结果存在系统性差异', () => {
    const vertical = buildDialGeometry(
      baseInput({ type: 'wall', wall: { azimuthDeg: 180, tiltFromVerticalDeg: 0 } }),
    );
    const tilted = buildDialGeometry(
      baseInput({ type: 'wall', wall: { azimuthDeg: 180, tiltFromVerticalDeg: 10 } }),
    );
    const v15 = vertical.hourLines.find((l) => l.hour === 15)!.points;
    const t15 = tilted.hourLines.find((l) => l.hour === 15)!.points;
    const vOuter = v15.reduce((a, b) => (Math.hypot(b.x, b.y) > Math.hypot(a.x, a.y) ? b : a));
    const tOuter = t15.reduce((a, b) => (Math.hypot(b.x, b.y) > Math.hypot(a.x, a.y) ? b : a));
    expect(distMm(vOuter, tOuter)).toBeGreaterThan(2);
  });
});

describe('跨纬度城市回归 (0.5mm 精度 + 结构合理性)', () => {
  for (const city of CITIES) {
    it(`${city.name} (φ=${city.latitudeDeg}°)`, () => {
      const dial = buildDialGeometry(baseInput({ location: city }));
      expect(dial.hourLines.some((l) => l.visible)).toBe(true);
      // 正午时线在任何纬度都应存在
      const noon = dial.hourLines.find((l) => l.hour === 12)!;
      expect(noon.visible).toBe(true);
      // 针的高度角 = 纬度 (水平式)
      expect(dial.gnomon.angleToPlaneDeg).toBeCloseTo(Math.abs(city.latitudeDeg), 0.01);
      // 全部可见刻线逐点校验
      for (const line of dial.hourLines) {
        if (!line.visible) continue;
        const ha = (line.hour - 12) * 15;
        const p = independentShadow(dial, ha, 0);
        if (p && Math.hypot(p.x, p.y) <= RADIUS) {
          expect(distanceToPolylineMm(p, line.points)).toBeLessThan(TOL_MM);
        }
      }
    });
  }
});

describe('南半球专项回归 (极轴与赤纬无关性)', () => {
  const sydney = CITIES.find((c) => c.name.startsWith('悉尼'))!;
  const dial = buildDialGeometry(baseInput({ location: sydney }));

  it('晷针直线平行地轴 (与北天极共线, 可同向或反向), 且装在盘面太阳侧', () => {
    const northPole = polarAxis(sydney.latitudeDeg);
    const q = dial.gnomon.styleDirection;
    expect(Math.abs(dot(q, northPole))).toBeCloseTo(1, 9); // 共线
    expect(dot(q, dial.frame.n)).toBeGreaterThan(0); // 在盘面上方
    // 南半球水平晷的针指向可见南天极: 水平分量朝南, 朝天
    expect(q.y).toBeLessThan(0);
    expect(q.z).toBeGreaterThan(0);
  });

  it('时线方向与赤纬无关 (叉积 (q×s)×n 在三个赤纬下方向一致)', () => {
    const angles: number[] = [];
    for (const dec of [-OBLIQUITY, 0, OBLIQUITY]) {
      const sun = sunVector(45, dec, sydney.latitudeDeg); // 15 点
      const dir = norm(cross(cross(dial.gnomon.styleDirection, sun), dial.frame.n));
      angles.push(Math.atan2(dir.x, dir.y));
    }
    for (let i = 1; i < angles.length; i++) {
      expect(Math.abs(angleDiff(angles[i], angles[0]))).toBeLessThan(1e-9);
    }
  });

  it('悉尼 15 点时线角大小等于经典水平式公式 atan(|sinφ|·tan|H|)', () => {
    const phi = sydney.latitudeDeg * DEG;
    const H = 45 * DEG;
    const expectedMag = Math.atan(Math.abs(Math.sin(phi)) * Math.abs(Math.tan(H)));
    const line = dial.hourLines.find((l) => l.hour === 15)!;
    expect(line.visible).toBe(true);
    const outer = line.points[1];
    // 与午线的无向锐角 (南半球影子落在午线另一侧, 角度可能 >90°, 取补角)
    const signed = Math.atan2(outer.x, outer.y);
    const actualMag = Math.abs(signed) > Math.PI / 2 ? Math.PI - Math.abs(signed) : Math.abs(signed);
    expect(Math.abs(actualMag - expectedMag)).toBeLessThan(0.002);
  });

  it('赤道式南半球上盘面法线朝天 (z>0)', () => {
    const eq = buildDialGeometry(baseInput({ location: sydney, type: 'equatorial' }));
    expect(eq.frame.n.z).toBeGreaterThan(0);
    expect(eq.gnomon.angleToPlaneDeg).toBeCloseTo(90, 6);
  });
});

describe('均时差 8 字线', () => {
  const dial = buildDialGeometry(baseInput({}));
  it('正午 8 字线生成且关于正午轴 (x≈0) 闭合', () => {
    const noon = dial.analemmas.find((a) => a.hour === 12)!;
    expect(noon.points.length).toBeGreaterThan(100);
    for (const p of noon.points) {
      expect(Math.abs(p.x)).toBeLessThan(0.02); // 正午 8 字基本沿 y 轴
    }
  });
  it('8 字纵向跨度与 EoT 全年幅度 (≈±16 分) 同量级', () => {
    const noon = dial.analemmas.find((a) => a.hour === 12)!;
    const ys = noon.points.map((p) => p.y);
    const spanMm = (Math.max(...ys) - Math.min(...ys)) * 1000;
    expect(spanMm).toBeGreaterThan(5);
  });
});

describe('晷针几何', () => {
  it('极轴方向高度角等于纬度', () => {
    const q = polarAxis(39.9042);
    expect(Math.asin(q.z) * (180 / Math.PI)).toBeCloseTo(39.9042, 8);
  });

  it('自动针长保证冬至正午影子落在盘面 85% 半径内', () => {
    const dial = buildDialGeometry(baseInput({}));
    const p = independentShadow(dial, 0, -OBLIQUITY)!;
    expect(Math.hypot(p.x, p.y)).toBeLessThan(RADIUS * 0.86);
  });
});
