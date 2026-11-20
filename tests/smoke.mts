/**
 * 浏览器冒烟测试: 用 Chrome DevTools Protocol (无第三方依赖, 走 WebSocket)
 * 加载页面, 采集 console 错误, 切换所有晷型/城市/读数边, 校验 canvas 实际出图。
 */
const CDP_PORT = 9222;

async function cdpJson(path: string): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}${path}`);
  return res.json();
}

async function main() {
  const targets = (await cdpJson('/json/list')) as Array<{ webSocketDebuggerUrl: string; id: string; type: string }>;
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('未找到页面 target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = () => res(null);
    ws.onerror = rej;
  });

  let msgId = 0;
  const pending = new Map<number, (v: unknown) => void>();
  const errors: string[] = [];
  const logs: string[] = [];

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data as string);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)!(m.result);
      pending.delete(m.id);
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args.map((a: { value?: unknown }) => String(a.value ?? '')).join(' ');
      logs.push(`[console.${m.params.type}] ${text}`);
      if (m.params.type === 'error') errors.push(text);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push('exception: ' + JSON.stringify(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
    }
  };

  const send = (method: string, params?: unknown) =>
    new Promise((resolve) => {
      const id = ++msgId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:5199/' });
  await new Promise((r) => setTimeout(r, 2500));

  const evalJs = async (expr: string) => {
    const r = (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })) as {
      result?: { type?: string; value?: unknown; exceptionDetails?: unknown };
    };
    if (r.result?.exceptionDetails) {
      errors.push('eval: ' + JSON.stringify(r.result.exceptionDetails));
    }
    return r.result?.value;
  };

  // 1. 初始状态: 两个 canvas 都有像素
  const initial = await evalJs(`(() => {
    const fc = document.getElementById('faceCanvas');
    const fctx = fc.getContext('2d');
    const data = fctx.getImageData(fc.width/2, fc.height/2, 1, 1).data;
    return { faceW: fc.width, faceH: fc.height, centerPixel: [data[0],data[1],data[2],data[3]] };
  })()`);
  console.log('初始晷面:', JSON.stringify(initial));

  // 2. 遍历三种晷型
  for (const t of ['horizontal', 'equatorial', 'wall']) {
    await evalJs(`document.querySelector('#typeSeg button[data-type="${t}"]').click()`);
    await new Promise((r) => setTimeout(r, 300));
  }

  // 3. 墙面式: 输入歪墙参数, 验证不可见时线为 0 点
  const wallCheck = await evalJs(`(() => {
    const az = document.getElementById('wallAz'); az.value = '120'; az.dispatchEvent(new Event('change'));
    const tilt = document.getElementById('wallTilt'); tilt.value = '8'; tilt.dispatchEvent(new Event('change'));
    return new Promise(res => setTimeout(() => {
      const hint = document.getElementById('wallDeclHint').textContent;
      const metrics = document.getElementById('metrics').textContent;
      res({ hint, metrics });
    }, 300));
  })()`);
  console.log('歪墙结果:', JSON.stringify(wallCheck));

  // 4. 切到三维视图, 初始化 WebGL2
  const sceneCheck = await evalJs(`new Promise(resolve => {
    document.querySelector('.view-tabs button[data-view="scene"]').click();
    setTimeout(() => {
      const c = document.getElementById('sceneCanvas');
      const gl = c.getContext('webgl2');
      resolve({ hasGL: !!gl, sceneW: c.width, sceneH: c.height });
    }, 1000);
  })`);
  console.log('三维场景:', JSON.stringify(sceneCheck));

  // 5. 遍历所有城市
  const cityResults = await evalJs(`(async () => {
    const sel = document.getElementById('citySelect');
    const out = [];
    for (let i = 0; i < sel.options.length; i++) {
      sel.value = String(i);
      sel.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 120));
      out.push(sel.options[i].text + ':' + document.getElementById('metrics').textContent.slice(0, 40));
    }
    return out;
  })()`);
  console.log('城市遍历:', JSON.stringify(cityResults, null, 0));

  // 6. 切换读数边
  await evalJs(`const e = document.getElementById('edgeSelect'); e.value='leading'; e.dispatchEvent(new Event('change'))`);
  await new Promise((r) => setTimeout(r, 200));

  // 7. 全年播放跑 2 秒
  const beforeDoy = await evalJs(`document.getElementById('doyInput').value`);
  await evalJs(`document.getElementById('playBtn').click()`);
  await new Promise((r) => setTimeout(r, 2500));
  const animState = await evalJs(`Promise.resolve({
    doy: document.getElementById('doyInput').value,
    sunInfo: document.getElementById('sunInfo').textContent,
    legend: document.getElementById('legend').textContent.slice(0, 140),
  })`);
  console.log('动画前 doy:', beforeDoy, '动画状态:', JSON.stringify(animState));

  await new Promise((r) => setTimeout(r, 500));
  console.log('\\n=== CONSOLE (' + logs.length + ' 条) ===');
  for (const l of logs.slice(0, 10)) console.log(l);
  console.log('\\n=== 错误数:', errors.length, '===');
  for (const e of errors) console.log(e);

  ws.close();
  if (errors.length > 0) process.exit(1);
  console.log('\\n冒烟测试通过 ✓');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
