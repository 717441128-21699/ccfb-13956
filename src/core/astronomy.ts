/**
 * 天文计算: 儒略日、恒星时、太阳视位置、均时差、日出没。
 *
 * 精度参考:
 *  - 太阳赤纬/均时差采用 NOAA Solar Position Algorithm 低精度公式
 *    (Reda & Andreas 2004 的截断版), 赤纬误差 < 0.01°, 均时差误差 < 0.2 分钟,
 *    折算到 0.3 m 晷面上的线位误差远小于 0.1 mm, 满足 0.5 mm 指标。
 *  - 时间基准: UTC, 日期输入为公历 proleptic Gregorian。
 */

import { DEG, RAD, TAU, clamp, wrap360 } from './vector3';
import type { Vec3 } from './vector3';

/** 公历日期(UTC)转儒略日 */
export function julianDay(year: number, month: number, day: number, hour = 0): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return (
    Math.floor(365.25 * (y + 4716)) +
    Math.floor(30.6001 * (m + 1)) +
    day +
    B -
    1524.5 +
    hour / 24
  );
}

/** Date 对象(UTC 分量)转儒略日 */
export function julianDayOfDate(d: Date): number {
  return julianDay(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600,
  );
}

/** 儒略世纪 (TT 近似, 忽略 ΔT 对几何方向的微小影响由 ΔT 修正项处理) */
export function julianCentury(jd: number): number {
  return (jd - 2451545.0) / 36525;
}

/** 格林尼治平恒星时, 单位度, 范围 [0,360) (NOAA 式) */
export function gmstDegrees(jd: number): number {
  const T = julianCentury(jd);
  const gmst =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * T * T -
    (T * T * T) / 38710000;
  return wrap360(gmst);
}

export interface SolarPosition {
  /** 太阳赤纬 (度) */
  declination: number;
  /** 均时差 (分钟, 正 = 真太阳时超前平太阳时) */
  equationOfTime: number;
  /** 几何平黄经 (度) */
  meanLongitude: number;
  /** 真黄经 (度) */
  trueLongitude: number;
  /** 地心视黄经 (度, 含光行差) */
  apparentLongitude: number;
  /** 黄赤交角 (度) */
  obliquity: number;
}

/**
 * 计算给定儒略日的太阳轨道参数。
 * 内部时间按 TT 近似 (jd + ΔT/86400), ΔT 取 NASA 2024 多项式。
 */
export function solarParameters(jdUtc: number, deltaTSeconds = deltaT(jdUtc)): SolarPosition {
  const jd = jdUtc + deltaTSeconds / 86400;
  const T = julianCentury(jd);

  // 几何平黄经 L0
  const L0 = wrap360(
    280.46646 + T * (36000.76983 + 0.0003032 * T),
  );
  // 平近点角 M
  const M = wrap360(357.52911 + T * (35999.05029 - 0.0001537 * T));
  // 地球轨道偏心率
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  // 中心差
  const Mr = M * DEG;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mr) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * Mr) +
    0.000289 * Math.sin(3 * Mr);
  const trueLongitude = L0 + C;
  // 章动与光行差
  const omega = wrap360(125.04 - 1934.136 * T);
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(omega * DEG);
  // 黄赤交角
  const sec0 =
    23 +
    (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const obliquity = sec0 + 0.00256 * Math.cos(omega * DEG);

  // 太阳赤纬
  const declination =
    Math.asin(Math.sin(obliquity * DEG) * Math.sin(apparentLongitude * DEG)) * RAD;

  // 均时差 (分钟)
  const y = Math.tan((obliquity / 2) * DEG) ** 2;
  const L0r = L0 * DEG;
  const EoT =
    (4 *
      RAD *
      (y * Math.sin(2 * L0r) -
        2 * e * Math.sin(Mr) +
        4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
        0.5 * y * y * Math.sin(4 * L0r) -
        1.25 * e * e * Math.sin(2 * Mr))) as number;

  return {
    declination,
    equationOfTime: EoT,
    meanLongitude: L0,
    trueLongitude,
    apparentLongitude,
    obliquity,
  };
}

/**
 * ΔT (TT-UTC, 秒) 的分段近似。
 * 2005 年前用 Espenak & Meeus 多项式, 之后用 NASA 近期线性外推。
 */
export function deltaT(jd: number): number {
  const year = 1858 + (jd - 2400000.5) / 365.2425;
  if (year < 2005) {
    const t = year - 2000;
    // 1986-2005 段
    if (year >= 1986) return 63.86 + 0.3345 * t - 0.060374 * t * t;
    if (year >= 1961) {
      const tt = year - 1975;
      return 45.45 + 1.067 * tt - tt * tt / 260 - tt * tt * tt / 718;
    }
    if (year >= 1941) return 29.07 + 0.407 * (year - 1950);
    if (year >= 1920) return 21.2 + 0.84493 * (year - 1920);
    if (year >= 1860) {
      const u = year - 1900;
      return -2.79 + 1.494119 * u - 0.0598939 * u * u + 0.0061966 * u ** 3 - 0.000197 * u ** 4;
    }
    const u = (year - 1820) / 100;
    return -20 + 103.9 * u * u;
  }
  // 2005 年后: IERS 实测附近线性, 远期取 +0.32 s/年
  const t = year - 2000;
  if (year <= 2015) return 64.69 + 0.29 * t;
  return 67.6 + 0.32 * (year - 2015);
}

export interface HorizontalSun {
  /** 方位角, 度, 自正北顺时针: 北=0, 东=90, 南=180, 西=270 */
  azimuth: number;
  /** 高度角, 度, 地平线上为正 */
  altitude: number;
  /** 站心单位方向向量 (ENU) */
  direction: Vec3;
  /** 时角, 度, 正午为 0, 下午为正 */
  hourAngle: number;
  /** 真太阳时 (小时, 0-24) */
  solarTime: number;
}

/**
 * 由 UTC 儒略日与经纬度求太阳地平坐标。
 * @param longitude 东经为正 (度)
 * @param latitude 北纬为正 (度)
 */
export function sunHorizontal(
  jdUtc: number,
  longitude: number,
  latitude: number,
): HorizontalSun {
  const sp = solarParameters(jdUtc);
  const gmst = gmstDegrees(jdUtc);
  // 格林尼治视恒星时(加章动修正的近似项已并入 GMST 精度, 这里补 equation of equinoxes)
  const T = julianCentury(jdUtc + deltaT(jdUtc) / 86400);
  const omega = wrap360(125.04 - 1934.136 * T) * DEG;
  const L0 = wrap360(280.46646 + T * (36000.76983 + 0.0003032 * T));
  const M = wrap360(357.52911 + T * (35999.05029 - 0.0001537 * T)) * DEG;
  const epsilon0 =
    23 +
    (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const dPsi =
    -17.2 * Math.sin(omega) - 1.32 * Math.sin(2 * L0 * DEG) - 0.23 * Math.sin(2 * M);
  const eqEq = dPsi * Math.cos(epsilon0 * DEG) / 3600; // 度
  const gast = gmst + eqEq;

  const lst = wrap360(gast + longitude);
  // 赤经
  const ra = Math.atan2(
    Math.cos(epsilon0 * DEG) * Math.sin(sp.apparentLongitude * DEG),
    Math.cos(sp.apparentLongitude * DEG),
  ) * RAD;
  const hourAngle = wrap360(lst - ra); // 度, 0..360
  const haSigned = hourAngle > 180 ? hourAngle - 360 : hourAngle;

  const phi = latitude * DEG;
  const dec = sp.declination * DEG;
  const ha = haSigned * DEG;

  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha);
  const altitude = Math.asin(clamp(sinAlt, -1, 1)) * RAD;
  const cosAz =
    (Math.sin(dec) - Math.sin(altitude * DEG) * Math.sin(phi)) /
    (Math.cos(altitude * DEG) * Math.cos(phi));
  let azimuth = Math.acos(clamp(cosAz, -1, 1)) * RAD;
  if (Math.sin(ha) > 0) azimuth = wrap360(360 - azimuth); // 下午在西侧

  const direction: Vec3 = {
    x: Math.cos(altitude * DEG) * Math.sin(azimuth * DEG),
    y: Math.cos(altitude * DEG) * Math.cos(azimuth * DEG),
    z: Math.sin(altitude * DEG),
  };

  // 真太阳时
  const solarTime = wrap360(haSigned + 180) / 15;

  return { azimuth, altitude, direction, hourAngle: haSigned, solarTime };
}

/**
 * 给定日期与经纬度, 返回真太阳时正午对应的 UTC 小时(浮点)。
 */
export function solarNoonUtc(jdUtcMidnight: number, longitude: number): number {
  const sp = solarParameters(jdUtcMidnight);
  // 正午 UTC ≈ (720 - 4·lon - EoT) 分钟
  const minutes = 720 - 4 * longitude - sp.equationOfTime;
  return wrap360(minutes) / 60;
}

/** 日出/日落(UTC 小时), 海拔高度角阈值默认 -0.833° (大气折射 + 视半径) */
export function sunriseSunset(
  jdUtcMidnight: number,
  longitude: number,
  latitude: number,
  altThresholdDeg = -0.833,
): { sunrise: number | null; sunset: number | null; polarDay: boolean } {
  const sp = solarParameters(jdUtcMidnight);
  const phi = latitude * DEG;
  const dec = sp.declination * DEG;
  const cosH =
    (Math.sin(altThresholdDeg * DEG) - Math.sin(phi) * Math.sin(dec)) /
    (Math.cos(phi) * Math.cos(dec));
  if (cosH < -1) return { sunrise: null, sunset: null, polarDay: true };
  if (cosH > 1) return { sunrise: null, sunset: null, polarDay: false };
  const H = Math.acos(cosH) * RAD; // 度
  const noon = solarNoonUtc(jdUtcMidnight, longitude);
  const halfDayHours = (H * 4) / 60; // H 度 * 4 分钟/度
  return {
    sunrise: noon - halfDayHours,
    sunset: noon + halfDayHours,
    polarDay: false,
  };
}

/**
 * 太阳光线与平面的临界条件辅助:
 * 返回一天中太阳方向点积墙面法向量为正的 UTC 小时区间(可多段, 通常 0 或 1 段)。
 * 通过对整点采样 + 二分求根, 稳健且不依赖解析公式。
 */
export function wallLitIntervals(
  jdUtcMidnight: number,
  longitude: number,
  latitude: number,
  wallNormal: Vec3,
  stepMinutes = 5,
): Array<[number, number]> {
  const samples: Array<{ t: number; d: number }> = [];
  const n = Math.ceil(24 * 60 / stepMinutes);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 24;
    const s = sunHorizontal(jdUtcMidnight + t / 24, longitude, latitude);
    // 必须同时满足: 太阳在地平线上 (含 -0.833° 折射阈值) 且照到墙面太阳侧
    const lit = s.altitude > -0.833 ? dot3(s.direction, wallNormal) : -1;
    samples.push({ t, d: lit });
  }
  const intervals: Array<[number, number]> = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    if (a.d > 0 && b.d > 0) {
      intervals.push([a.t, b.t]);
    } else if (a.d > 0 || b.d > 0) {
      // 二分求根
      let lo = a;
      let hi = b;
      for (let k = 0; k < 40; k++) {
        const mid = (lo.t + hi.t) / 2;
        const sm = sunHorizontal(jdUtcMidnight + mid / 24, longitude, latitude);
        const dm = dot3(sm.direction, wallNormal);
        if ((dm > 0) === (lo.d > 0)) lo = { t: mid, d: dm };
        else hi = { t: mid, d: dm };
      }
      const root = (lo.t + hi.t) / 2;
      if (a.d > 0) intervals.push([a.t, root]);
      else intervals.push([root, b.t]);
    }
  }
  const merged = mergeIntervals(intervals, stepMinutes / 60 / 2);
  // 规范化跨 UTC 午夜的环绕区间: 拆成 [0, hi-24] 与 [lo, 24] 两段
  const out: Array<[number, number]> = [];
  for (const [lo, hi] of merged) {
    if (hi > 24) {
      out.push([0, hi - 24]);
      out.push([lo, 24]);
    } else {
      out.push([lo, hi]);
    }
  }
  return mergeIntervals(out, stepMinutes / 60 / 2);
}

function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function mergeIntervals(iv: Array<[number, number]>, eps: number): Array<[number, number]> {
  if (iv.length === 0) return iv;
  const sorted = [...iv].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i][0] <= last[1] + eps) last[1] = Math.max(last[1], sorted[i][1]);
    else out.push(sorted[i]);
  }
  return out;
}

/** 平太阳时 -> 真太阳时修正(分钟), 即 EoT */
export function equationOfTimeMinutes(jdUtc: number): number {
  return solarParameters(jdUtc).equationOfTime;
}

/** 工具: 年积日 (1..366) */
export function dayOfYear(year: number, month: number, day: number): number {
  const j1 = julianDay(year, 1, 1);
  const j2 = julianDay(year, month, day);
  return Math.round(j2 - j1) + 1;
}

export { TAU };
