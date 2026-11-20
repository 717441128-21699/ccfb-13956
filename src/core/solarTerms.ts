/**
 * 二十四节气与太阳黄经/赤纬。
 * 节气按太阳视黄经每 15° 一个, 春分黄经为 0°。
 */

import { DEG, RAD } from './vector3';

export interface SolarTerm {
  /** 节气名 */
  name: string;
  /** 太阳视黄经 (度) */
  longitude: number;
}

export const SOLAR_TERMS: SolarTerm[] = [
  { name: '春分', longitude: 0 },
  { name: '清明', longitude: 15 },
  { name: '谷雨', longitude: 30 },
  { name: '立夏', longitude: 45 },
  { name: '小满', longitude: 60 },
  { name: '芒种', longitude: 75 },
  { name: '夏至', longitude: 90 },
  { name: '小暑', longitude: 105 },
  { name: '大暑', longitude: 120 },
  { name: '立秋', longitude: 135 },
  { name: '处暑', longitude: 150 },
  { name: '白露', longitude: 165 },
  { name: '秋分', longitude: 180 },
  { name: '寒露', longitude: 195 },
  { name: '霜降', longitude: 210 },
  { name: '立冬', longitude: 225 },
  { name: '小雪', longitude: 240 },
  { name: '大雪', longitude: 255 },
  { name: '冬至', longitude: 270 },
  { name: '小寒', longitude: 285 },
  { name: '大寒', longitude: 300 },
  { name: '立春', longitude: 315 },
  { name: '雨水', longitude: 330 },
  { name: '惊蛰', longitude: 345 },
];

/** 黄赤交角 (度), J2000 平值, 引擎内与 astronomy 保持一致的精度口径 */
export const OBLIQUITY = 23.4392911;

/** 由太阳视黄经求赤纬 (度) */
export function declinationFromLongitude(longitudeDeg: number, obliquity = OBLIQUITY): number {
  return (
    Math.asin(Math.sin(obliquity * DEG) * Math.sin(longitudeDeg * DEG)) * RAD
  );
}

export interface TermDeclination extends SolarTerm {
  declination: number;
}

/** 全部节气对应的赤纬 */
export function termDeclinations(obliquity = OBLIQUITY): TermDeclination[] {
  return SOLAR_TERMS.map((t) => ({
    ...t,
    declination: declinationFromLongitude(t.longitude, obliquity),
  }));
}

/** 二至二分 (用于晷面主标注) */
export const MAJOR_TERMS = ['春分', '夏至', '秋分', '冬至'] as const;
