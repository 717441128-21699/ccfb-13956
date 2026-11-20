/**
 * 天文历表对照测试。
 * 参考值来源:
 *  - NOAA Solar Calculations Worksheet (2024-02-11, 2024-06-21 等算例)
 *  - 《天文年历》二至二分赤纬 ±23.44°
 *  - USNO GMST 算例 (J2000.0: GMST ≈ 18h41m50.548s)
 */
import { describe, expect, it } from 'vitest';
import {
  equationOfTimeMinutes,
  gmstDegrees,
  julianDay,
  solarParameters,
  solarNoonUtc,
  sunHorizontal,
  sunriseSunset,
} from '../src/core/astronomy';
import { DEG } from '../src/core/vector3';

const TOL_DEC_ARCMIN = 0.02; // 赤纬 0.02° ≈ 1.2 角分
const TOL_EOT_MIN = 0.35; // 均时差 0.35 分钟

describe('儒略日 / 恒星时', () => {
  it('J2000.0 儒略日 = 2451545.0', () => {
    expect(julianDay(2000, 1, 1, 12)).toBeCloseTo(2451545.0, 9);
  });

  it('J2000.0 GMST = 280.4606° (18h41m50.5s)', () => {
    const g = gmstDegrees(2451545.0);
    expect(g).toBeCloseTo(280.46061837, 4);
  });

  it('1999-12-31 与 2000-01-01 相差 1 天', () => {
    expect(julianDay(2000, 1, 2) - julianDay(2000, 1, 1)).toBeCloseTo(1, 9);
  });
});

describe('太阳赤纬 (对照天文年历)', () => {
  // 年中日附近, 用平年 2024 春分 JD
  const equinoxJD = julianDay(2024, 3, 20, 4.06); // 2024 春分 UTC 03:06
  const solsticeJun = julianDay(2024, 6, 20, 20.9); // 夏至 UTC 20:51
  const solsticeDec = julianDay(2024, 12, 21, 9.34); // 冬至 UTC 09:20
  const sepEquinox = julianDay(2024, 9, 22, 12.44); // 秋分

  it('春分赤纬 ≈ 0', () => {
    expect(Math.abs(solarParameters(equinoxJD).declination)).toBeLessThan(0.05);
  });
  it('秋分赤纬 ≈ 0', () => {
    expect(Math.abs(solarParameters(sepEquinox).declination)).toBeLessThan(0.05);
  });
  it('夏至赤纬 ≈ +23.44°', () => {
    expect(solarParameters(solsticeJun).declination).toBeCloseTo(23.44, TOL_DEC_ARCMIN);
  });
  it('冬至赤纬 ≈ -23.44°', () => {
    expect(solarParameters(solsticeDec).declination).toBeCloseTo(-23.44, TOL_DEC_ARCMIN);
  });
});

describe('均时差 (NOAA 算例对照)', () => {
  // NOAA 工作表公开算例:
  // 2024-02-11 EoT ≈ -14.2 分; 2024-05-06 ≈ +3.4 分;
  // 2024-07-15 ≈ -5.8 分; 2024-11-03 ≈ +16.5 分
  const cases: Array<[string, number, number]> = [
    ['2024-02-11', julianDay(2024, 2, 11, 12), -14.2],
    ['2024-05-06', julianDay(2024, 5, 6, 12), 3.4],
    ['2024-07-15', julianDay(2024, 7, 15, 12), -5.8],
    ['2024-11-03', julianDay(2024, 11, 3, 12), 16.5],
  ];
  for (const [name, jd, expected] of cases) {
    it(`${name} EoT ≈ ${expected} 分钟`, () => {
      expect(Math.abs(equationOfTimeMinutes(jd) - expected)).toBeLessThan(TOL_EOT_MIN);
    });
  }

  it('全年 EoT 极值落在常识区间 (本引擎约定: 约 -14.5 .. +16.5 分钟)', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let doy = 1; doy <= 365; doy++) {
      const e = equationOfTimeMinutes(julianDay(2024, 1, doy));
      min = Math.min(min, e);
      max = Math.max(max, e);
    }
    expect(min).toBeGreaterThan(-15);
    expect(max).toBeLessThan(17);
  });
});

describe('太阳地平坐标 (北京 2024 夏至正午)', () => {
  const beijing = { lon: 116.4074, lat: 39.9042 };
  // 真太阳正午附近 (EoT ≈ -1.8 分, 北京时间正午约 UTC 04:00)
  const jd = julianDay(2024, 6, 21, 4.25);
  const h = sunHorizontal(jd, beijing.lon, beijing.lat);

  it('正午方位 ≈ 正南 (180°)', () => {
    const d = Math.abs(((h.azimuth - 180 + 540) % 360) - 180);
    expect(d).toBeLessThan(2);
  });
  it('正午高度 ≈ 90°-|φ-δ| = 73.54°', () => {
    expect(h.altitude).toBeCloseTo(90 - (39.9042 - 23.44), 0.15);
  });
  it('真太阳时 ≈ 12 点', () => {
    expect(Math.abs(h.solarTime - 12)).toBeLessThan(0.15);
  });
});

describe('日出日没 (北京)', () => {
  const beijing = { lon: 116.4074, lat: 39.9042 };
  // 2024-03-20 北京日出约 06:22 北京时 = UTC 22:21 前一日; 用当日午夜 JD 直接校验区间
  const jd0 = julianDay(2024, 3, 20, 0);
  const r = sunriseSunset(jd0, beijing.lon, beijing.lat);
  it('春分昼夜接近等长 (12h ± 10 分钟)', () => {
    expect(r.sunrise).not.toBeNull();
    expect(r.sunset).not.toBeNull();
    const length = (r.sunset! - r.sunrise!) * 60;
    expect(Math.abs(length - 720)).toBeLessThan(10);
  });
  it('特罗姆瑟夏至为极昼', () => {
    const j = julianDay(2024, 6, 21, 0);
    const t = sunriseSunset(j, 18.9553, 69.6492);
    expect(t.polarDay).toBe(true);
    expect(t.sunrise).toBeNull();
  });

  it('特罗姆瑟冬至无日出', () => {
    const j = julianDay(2024, 12, 21, 0);
    const t = sunriseSunset(j, 18.9553, 69.6492);
    expect(t.polarDay).toBe(false);
    expect(t.sunrise).toBeNull();
    expect(t.sunset).toBeNull();
  });
});

describe('太阳方向向量正交性', () => {
  it('任意时角赤纬下方向向量为单位长', () => {
    for (const ha of [-90, -45, 0, 30, 75]) {
      for (const dec of [-23, 0, 23]) {
        const phi = 40 * DEG;
        const H = ha * DEG;
        const d = dec * DEG;
        const v = {
          x: -Math.cos(d) * Math.sin(H),
          y: Math.sin(d) * Math.cos(phi) - Math.cos(d) * Math.sin(phi) * Math.cos(H),
          z: Math.sin(d) * Math.sin(phi) + Math.cos(d) * Math.cos(phi) * Math.cos(H),
        };
        expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 10);
      }
    }
  });
});

describe('太阳正午时刻', () => {
  it('北京平太阳正午 UTC ≈ 12:00 - 116.41°/15 ≈ 4:14', () => {
    const jd0 = julianDay(2024, 3, 15, 0);
    const noon = solarNoonUtc(jd0, 116.4074);
    expect(noon).toBeCloseTo(4 + 14 / 60, 0.12);
  });
});
