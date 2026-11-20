/**
 * 晷面二维渲染 (Canvas2D): 时线、节气线、均时差 8 字线、晷针与标注。
 * 输入 DialGeometry 的晷面坐标 (米), 按比例映射到画布。
 */
import type { DialGeometry, Vec2 } from '../core/dialGeometry';

export interface FaceRenderOptions {
  showHourLines: boolean;
  showTermLines: boolean;
  showAnalemma: boolean;
  showLabels: boolean;
  /** 只画可见时线 (默认 true, 保证不可见段不被画出) */
  onlyVisible: boolean;
}

const COLORS = {
  plate: '#f4efe2',
  rim: '#3a342b',
  hour: '#2b2620',
  hourMajor: '#111010',
  term: '#8a5a2b',
  termMajor: '#b03a2e',
  analemma: '#1f5c99',
  gnomon: '#4a4f57',
  shadow: 'rgba(20,16,10,0.55)',
  shadowSoft: 'rgba(20,16,10,0.22)',
  text: '#2b2620',
};

export class FaceRenderer {
  private ctx: CanvasRenderingContext2D;
  private scale: number;

  constructor(
    private canvas: HTMLCanvasElement,
    private dial: DialGeometry,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取 2D 上下文');
    this.ctx = ctx;
    this.scale = 1;
  }

  /** 米 -> 画布像素, 盘面 +y 朝上 */
  private toPx(p: Vec2): Vec2 {
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    return { x: cx + p.x * this.scale, y: cy - p.y * this.scale };
  }

  private trace(points: Vec2[]): void {
    const ctx = this.ctx;
    if (points.length === 0) return;
    const p0 = this.toPx(points[0]);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < points.length; i++) {
      const p = this.toPx(points[i]);
      ctx.lineTo(p.x, p.y);
    }
  }

  render(opts: FaceRenderOptions, shadow?: Vec2 | null, softShadow?: Vec2 | null): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.scale = (Math.min(w, h) / 2 / this.dial.radiusM) * 0.92;

    ctx.clearRect(0, 0, w, h);
    // 盘面
    const cx = w / 2;
    const cy = h / 2;
    const rPx = this.dial.radiusM * this.scale;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.plate;
    ctx.fill();
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = COLORS.rim;
    ctx.stroke();

    // 节气线 (画在时线下层)
    if (opts.showTermLines) {
      for (const term of this.dial.termLines) {
        if (term.points.length < 2) continue;
        this.trace(term.points);
        ctx.strokeStyle = term.major ? COLORS.termMajor : COLORS.term;
        ctx.lineWidth = (term.major ? 1.6 : 0.8) * dpr;
        ctx.setLineDash(term.major ? [] : [4 * dpr, 3 * dpr]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (opts.showLabels && term.major) this.labelTerm(term.termNames[0], term.points);
      }
    }

    // 时线
    if (opts.showHourLines) {
      for (const line of this.dial.hourLines) {
        if (opts.onlyVisible && !line.visible) continue;
        if (line.points.length < 2) continue;
        const major = line.hour % 3 === 0;
        this.trace(line.points);
        ctx.strokeStyle = major ? COLORS.hourMajor : COLORS.hour;
        ctx.lineWidth = (major ? 1.8 : 1) * dpr;
        ctx.stroke();
        // 盘边刻度小短线 + 标签
        if (opts.showLabels) this.labelHour(line.hour, line.points);
      }
    }

    // 均时差 8 字线
    if (opts.showAnalemma) {
      for (const a of this.dial.analemmas) {
        if (a.points.length < 2) continue;
        this.trace(a.points);
        ctx.strokeStyle = COLORS.analemma;
        ctx.lineWidth = 1.4 * dpr;
        ctx.stroke();
      }
    }

    // 晷针 (副晷针方向)
    const g = this.dial.gnomon;
    if (g.subStyleDirection) {
      const tip = {
        x: g.subStyleDirection.x * g.lengthM,
        y: g.subStyleDirection.y * g.lengthM,
      };
      this.trace([{ x: 0, y: 0 }, tip]);
      ctx.strokeStyle = COLORS.gnomon;
      ctx.lineWidth = 3 * dpr;
      ctx.stroke();
    }
    // 中心
    ctx.beginPath();
    ctx.arc(cx, cy, 3 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.gnomon;
    ctx.fill();

    // 影子 (半影软边 + 本影读点)
    if (softShadow) this.drawShadowDot(softShadow, 7 * dpr, COLORS.shadowSoft);
    if (shadow) this.drawShadowDot(shadow, 4 * dpr, COLORS.shadow);

    ctx.restore();
  }

  private drawShadowDot(p: Vec2, radiusPx: number, color: string): void {
    const ctx = this.ctx;
    const q = this.toPx(p);
    ctx.beginPath();
    ctx.arc(q.x, q.y, radiusPx, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  private labelHour(hour: number, points: Vec2[]): void {
    const ctx = this.ctx;
    const outer = points.reduce((a, b) =>
      Math.hypot(b.x, b.y) > Math.hypot(a.x, a.y) ? b : a,
    );
    const p = this.toPx({
      x: outer.x * 1.06,
      y: outer.y * 1.06,
    });
    ctx.fillStyle = COLORS.text;
    ctx.font = `${Math.max(11, 13 * (window.devicePixelRatio || 1))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${hour}`, p.x, p.y);
  }

  private labelTerm(name: string, points: Vec2[]): void {
    const ctx = this.ctx;
    // 取线的一端做标注
    const end = points[points.length - 1];
    const p = this.toPx(end);
    ctx.fillStyle = COLORS.termMajor;
    ctx.font = `${12 * (window.devicePixelRatio || 1)}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(name, p.x + 3, p.y);
  }
}
