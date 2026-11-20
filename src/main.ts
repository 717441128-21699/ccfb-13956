/**
 * 应用主控制器: 收集 UI 输入 -> 构建 DialGeometry -> 驱动 2D/3D 渲染与年度动画。
 */
import {
  buildDialGeometry,
  type DialGeometry,
  type DialInput,
  type DialType,
  type ShadowEdge,
} from './core/dialGeometry';
import { CITIES } from './core/cities';
import { FaceRenderer } from './render/faceRenderer';
import { SceneRenderer } from './render/sceneRenderer';
import { AnnualAnimation } from './render/animation';

interface UIState {
  cityIndex: number;
  lat: number;
  lon: number;
  type: DialType;
  wallAz: number;
  wallTilt: number;
  radiusMm: number;
  thicknessMm: number;
  lengthMm: number;
  edge: ShadowEdge;
  analemma: boolean;
  showHour: boolean;
  showTerm: boolean;
  showLabel: boolean;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

class App {
  private state: UIState = {
    cityIndex: 0,
    lat: CITIES[0].latitudeDeg,
    lon: CITIES[0].longitudeDeg,
    type: 'horizontal',
    wallAz: 180,
    wallTilt: 0,
    radiusMm: 300,
    thicknessMm: 4,
    lengthMm: 0,
    edge: 'center',
    analemma: true,
    showHour: true,
    showTerm: true,
    showLabel: true,
  };

  private dial!: DialGeometry;
  private face!: FaceRenderer;
  private scene: SceneRenderer | null = null;
  private anim!: AnnualAnimation;
  private activeView: 'face' | 'scene' = 'face';
  private lastTs = 0;
  private sceneInitialized = false;

  constructor() {
    this.bindStaticUI();
    this.rebuild();
    this.anim = new AnnualAnimation(this.dial);
    this.face = new FaceRenderer($<HTMLCanvasElement>('faceCanvas'), this.dial);
    this.loop = this.loop.bind(this);
    this.attachOrbit();
    requestAnimationFrame(this.loop);
  }

  private bindStaticUI(): void {
    const citySel = $<HTMLSelectElement>('citySelect');
    citySel.innerHTML = CITIES.map((c, i) => `<option value="${i}">${c.name}</option>`).join('');
    citySel.value = '0';
    citySel.addEventListener('change', () => {
      const c = CITIES[Number(citySel.value)];
      this.state.cityIndex = Number(citySel.value);
      this.state.lat = c.latitudeDeg;
      this.state.lon = c.longitudeDeg;
      $<HTMLInputElement>('latInput').value = String(c.latitudeDeg);
      $<HTMLInputElement>('lonInput').value = String(c.longitudeDeg);
      this.rebuild();
    });

    $<HTMLInputElement>('latInput').addEventListener('change', (e) => {
      this.state.lat = Number((e.target as HTMLInputElement).value);
      this.rebuild();
    });
    $<HTMLInputElement>('lonInput').addEventListener('change', (e) => {
      this.state.lon = Number((e.target as HTMLInputElement).value);
      this.rebuild();
    });

    $<HTMLDivElement>('typeSeg').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!btn) return;
      this.state.type = btn.dataset.type as DialType;
      document.querySelectorAll<HTMLButtonElement>('#typeSeg button').forEach((b) => b.classList.toggle('active', b === btn));
      $<HTMLDivElement>('wallControls').hidden = this.state.type !== 'wall';
      this.rebuild();
    });

    for (const id of ['wallAz', 'wallTilt', 'radiusInput', 'thickInput', 'lenInput']) {
      $(id).addEventListener('change', () => this.rebuild());
    }
    $<HTMLSelectElement>('edgeSelect').addEventListener('change', (e) => {
      this.state.edge = (e.target as HTMLSelectElement).value as ShadowEdge;
      this.rebuild();
    });
    $<HTMLInputElement>('analemmaChk').addEventListener('change', (e) => {
      this.state.analemma = (e.target as HTMLInputElement).checked;
      this.renderFace();
    });
    for (const id of ['showHour', 'showTerm', 'showLabel']) {
      $(id).addEventListener('change', () => {
        this.state.showHour = $<HTMLInputElement>('showHour').checked;
        this.state.showTerm = $<HTMLInputElement>('showTerm').checked;
        this.state.showLabel = $<HTMLInputElement>('showLabel').checked;
        this.renderFace();
      });
    }

    // 时刻控制
    $<HTMLInputElement>('doyInput').addEventListener('input', (e) => {
      this.anim?.setDayOfYear(Number((e.target as HTMLInputElement).value));
    });
    $<HTMLInputElement>('hourInput').addEventListener('input', (e) => {
      this.anim?.setUtcHour(Number((e.target as HTMLInputElement).value));
    });
    $<HTMLButtonElement>('playBtn').addEventListener('click', () => {
      this.anim.toggle();
      $<HTMLButtonElement>('playBtn').textContent = this.anim.cfg.playing ? '⏸ 暂停' : '▶ 全年播放';
    });
    $<HTMLInputElement>('yearSec').addEventListener('change', (e) => {
      this.anim.cfg.yearDurationSec = Number((e.target as HTMLInputElement).value);
    });

    // 视图切换
    document.querySelectorAll<HTMLButtonElement>('.view-tabs button').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeView = btn.dataset.view as 'face' | 'scene';
        document.querySelectorAll('.view-tabs button').forEach((b) =>
          b.classList.toggle('active', b === btn),
        );
        $('faceCanvas').classList.toggle('active', this.activeView === 'face');
        $('sceneCanvas').classList.toggle('active', this.activeView === 'scene');
        if (this.activeView === 'scene' && !this.sceneInitialized) this.initScene();
        this.resize();
      });
    });

    window.addEventListener('resize', () => this.resize());
  }

  private readInputs(): DialInput {
    this.state.wallAz = Number($<HTMLInputElement>('wallAz').value);
    this.state.wallTilt = Number($<HTMLInputElement>('wallTilt').value);
    this.state.radiusMm = Number($<HTMLInputElement>('radiusInput').value);
    this.state.thicknessMm = Number($<HTMLInputElement>('thickInput').value);
    this.state.lengthMm = Number($<HTMLInputElement>('lenInput').value);

    const input: DialInput = {
      location: {
        name: CITIES[this.state.cityIndex]?.name ?? '自定义',
        latitudeDeg: this.state.lat,
        longitudeDeg: this.state.lon,
      },
      type: this.state.type,
      radiusM: this.state.radiusMm / 1000,
      styleThicknessM: this.state.thicknessMm / 1000,
      shadowEdge: this.state.edge,
    };
    if (this.state.lengthMm > 0) input.gnomonLengthM = this.state.lengthMm / 1000;
    if (this.state.type === 'wall') {
      input.wall = {
        azimuthDeg: this.state.wallAz,
        tiltFromVerticalDeg: this.state.wallTilt,
      };
    }
    return input;
  }

  private rebuild(): void {
    try {
      this.dial = buildDialGeometry(this.readInputs());
      this.face = new FaceRenderer($<HTMLCanvasElement>('faceCanvas'), this.dial);
      this.anim?.reset(this.dial);
      if (this.scene && this.sceneInitialized) this.initScene();
      this.updateMetrics();
      this.updateWallHint();
      this.resize();
    } catch (err) {
      console.error(err);
    }
  }

  private initScene(): void {
    const canvas = $<HTMLCanvasElement>('sceneCanvas');
    this.scene = new SceneRenderer(canvas, this.dial);
    this.sceneInitialized = true;
    this.resize();
  }

  private updateMetrics(): void {
    const g = this.dial.gnomon;
    const visibleCount = this.dial.hourLines.filter((l) => l.visible).length;
    const rows: Array<[string, string]> = [
      ['晷针-盘面夹角', `${g.angleToPlaneDeg.toFixed(3)}°`],
      ['晷针长度', `${(g.lengthM * 1000).toFixed(1)} mm`],
      ['针突出盘面', `${(g.protrusionM * 1000).toFixed(1)} mm`],
      [
        '副晷针角',
        g.subStyleAngleDeg === null ? '— (垂直盘面)' : `${g.subStyleAngleDeg.toFixed(3)}°`,
      ],
      ['可见时线', `${visibleCount} / ${this.dial.hourLines.length}`],
      ['节气线', `${this.dial.termLines.length} 条`],
      ['半影软带宽', `${g.penumbraMm.toFixed(2)} mm`],
    ];
    if (this.dial.wallDeclinationDeg !== null) {
      rows.push(['墙偏正南', `${this.dial.wallDeclinationDeg.toFixed(2)}°`]);
    }
    $('metrics').innerHTML = rows
      .map(([k, v]) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`)
      .join('');
  }

  private updateWallHint(): void {
    const hint = $('wallDeclHint');
    if (this.state.type !== 'wall' || this.dial.wallDeclinationDeg === null) {
      hint.textContent = '';
      hint.className = 'hint';
      return;
    }
    const d = this.dial.wallDeclinationDeg;
    const dir = d > 0 ? '西偏' : d < 0 ? '东偏' : '正向';
    const invisible = this.dial.hourLines.filter((l) => !l.visible).length;
    hint.innerHTML = `相对正南${dir} <b>${Math.abs(d).toFixed(2)}°</b>；${invisible} 根时线全年无直射，已按物理结果省略，不做虚假刻线。`;
    hint.className = Math.abs(d) > 30 ? 'hint warn' : 'hint ok';
  }

  private renderFace(): void {
    if (!this.face) return;
    const sh = this.anim?.shadow();
    const reading = sh?.readingPoint ?? null;
    // 半影点: 用中心影子外扩 penumbra 半径近似
    let soft = reading;
    if (reading && sh) {
      soft = reading; // FaceRenderer 用大圆点表现软边
    }
    this.face.render(
      {
        showHourLines: this.state.showHour,
        showTermLines: this.state.showTerm,
        showAnalemma: this.state.analemma,
        showLabels: this.state.showLabel,
        onlyVisible: true,
      },
      reading,
      soft,
    );
    this.updateLegend(sh ?? null);
  }

  private updateLegend(sh: ReturnType<AnnualAnimation['shadow']> | null): void {
    if (!sh) return;
    const status = !sh.aboveHorizon
      ? '太阳在地平线下'
      : sh.faceLit
        ? '<b style="color:var(--ok)">阳光直射晷面</b>'
        : '<b style="color:var(--danger)">阳光照不到该面</b>';
    $('legend').innerHTML = `
      <div>太阳高度 <b>${sh.altitudeDeg.toFixed(2)}°</b> · 方位 <b>${sh.azimuthDeg.toFixed(2)}°</b></div>
      <div>真太阳时 <b>${sh.solarTime.toFixed(2)} h</b> · ${status}</div>
      <div>半影软带 <b>${sh.penumbraWidthMm.toFixed(2)} mm</b> · 本影半宽 <b>${sh.umbraHalfWidthMm.toFixed(2)} mm</b></div>
      <div>读数边: <b>${edgeLabel(this.state.edge)}</b></div>`;
    $('sunInfo').textContent =
      `高度 ${sh.altitudeDeg.toFixed(1)}° 方位 ${sh.azimuthDeg.toFixed(1)}° 真太阳时 ${sh.solarTime.toFixed(2)}h`;
  }

  private attachOrbit(): void {
    const canvas = $<HTMLCanvasElement>('sceneCanvas');
    let dragging = false;
    let lx = 0;
    let ly = 0;
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging || !this.scene) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      this.scene.orbit.yaw -= dx * 0.006;
      this.scene.orbit.pitch = Math.max(-0.2, Math.min(1.4, this.scene.orbit.pitch + dy * 0.006));
    });
    canvas.addEventListener('pointerup', () => (dragging = false));
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.scene) return;
        e.preventDefault();
        this.scene.orbit.distance = Math.max(
          this.dial.radiusM * 1.5,
          Math.min(this.dial.radiusM * 10, this.scene.orbit.distance * (1 + e.deltaY * 0.001)),
        );
      },
      { passive: false },
    );
  }

  private resize(): void {
    const faceCanvas = $<HTMLCanvasElement>('faceCanvas');
    const sceneCanvas = $<HTMLCanvasElement>('sceneCanvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [faceCanvas, sceneCanvas]) {
      const rect = c.parentElement!.getBoundingClientRect();
      c.width = Math.floor(rect.width * dpr);
      c.height = Math.floor(rect.height * dpr);
    }
    this.scene?.resize(
      sceneCanvas.parentElement!.clientWidth,
      sceneCanvas.parentElement!.clientHeight,
    );
  }

  private loop(ts: number): void {
    const dt = this.lastTs ? Math.min(0.1, (ts - this.lastTs) / 1000) : 0;
    this.lastTs = ts;
    if (this.anim) {
      this.anim.update(dt);
      $<HTMLInputElement>('doyInput').value = String(this.anim.cfg.dayOfYear);
    }
    if (this.activeView === 'face') {
      this.renderFace();
    } else if (this.scene && this.anim) {
      const sh = this.anim.shadow();
      this.scene.setSunDirection(sh.sun);
      const umbra = sh.faceLit ? Math.max(0.15, 0.5 - sh.umbraHalfWidthMm / 20) : 0;
      this.scene.updateShadow(this.dial, sh.penumbraWidthMm, umbra);
      this.scene.render();
      this.updateLegend(sh);
    }
    requestAnimationFrame(this.loop);
  }
}

function edgeLabel(e: ShadowEdge): string {
  return e === 'leading' ? '向日边 (本影外缘)' : e === 'trailing' ? '背日边' : '中心线';
}

new App();
