/**
 * 年度遍历动画: 在指定天数内把一整年的影子走一遍, 支持播放/暂停/调速/拖动。
 * 内部用 2024 闰年的日序 (1..366), 时刻可固定为某真太阳时或跟随全天。
 */
import { julianDay, sunHorizontal } from '../core/astronomy';
import type { DialGeometry } from '../core/dialGeometry';
import { computeShadow, type ShadowState } from '../core/shadow';

export interface AnimationConfig {
  /** 全年遍历耗时 (秒) */
  yearDurationSec: number;
  playing: boolean;
  /** 日序 1..366 */
  dayOfYear: number;
  /** 一天内的 UTC 小时 0..24 */
  utcHour: number;
  /** 是否锁定真太阳时 (随日期修正 EoT) */
  followSolarTime: boolean;
}

export class AnnualAnimation {
  cfg: AnimationConfig = {
    yearDurationSec: 24,
    playing: false,
    dayOfYear: 172,
    utcHour: 12,
    followSolarTime: true,
  };

  private accumDays = 172;

  constructor(private dial: DialGeometry) {
    this.accumDays = 172;
  }

  reset(dial: DialGeometry): void {
    this.dial = dial;
  }

  play(): void {
    this.cfg.playing = true;
  }

  pause(): void {
    this.cfg.playing = false;
  }

  toggle(): void {
    this.cfg.playing = !this.cfg.playing;
  }

  setDayOfYear(doy: number): void {
    this.accumDays = clamp(doy, 1, 366);
    this.cfg.dayOfYear = Math.round(this.accumDays);
  }

  setUtcHour(h: number): void {
    this.cfg.utcHour = clamp(h, 0, 24);
  }

  /** 每帧推进 dtSec 秒 */
  update(dtSec: number): void {
    if (this.cfg.playing) {
      const speed = 366 / this.cfg.yearDurationSec;
      this.accumDays += dtSec * speed;
      if (this.accumDays > 366) this.accumDays -= 366;
      this.cfg.dayOfYear = Math.round(this.accumDays);
    } else {
      this.accumDays = this.cfg.dayOfYear;
    }
  }

  /** 当前动画时刻 (UTC Date) */
  currentDate(): Date {
    const doy = this.accumDays;
    const jd0 = julianDay(2024, 1, 1);
    // 由日序反推月日
    const jd = jd0 + doy - 1;
    const d = jdToDate(jd);
    let hour = this.cfg.utcHour;
    if (this.cfg.followSolarTime) {
      // 把本地平太阳时换算回 UTC, 再叠加 EoT
      const lon = this.dial.input.location.longitudeDeg;
      hour = clamp(this.cfg.utcHour - lon / 15, 0, 24);
    }
    d.setUTCHours(hour, 0, 0, 0);
    return d;
  }

  shadow(): ShadowState {
    return computeShadow(this.dial, this.currentDate());
  }

  /** 当天太阳信息 (用于 UI 显示) */
  sunInfo(): { azimuth: number; altitude: number; solarTime: number } {
    const jd = julianDay(
      2024,
      this.currentDate().getUTCMonth() + 1,
      this.currentDate().getUTCDate(),
      this.currentDate().getUTCHours() +
        this.currentDate().getUTCMinutes() / 60,
    );
    const h = sunHorizontal(
      jd,
      this.dial.input.location.longitudeDeg,
      this.dial.input.location.latitudeDeg,
    );
    return { azimuth: h.azimuth, altitude: h.altitude, solarTime: h.solarTime };
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** 儒略日 (含小数) -> UTC Date */
function jdToDate(jd: number): Date {
  return new Date((jd - 2440587.5) * 86400000);
}
