const CDP_PORT = 9222;
async function main() {
  const targets = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()) as Array<{ webSocketDebuggerUrl: string; type: string }>;
  const page = targets.find((t) => t.type === 'page')!;
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = () => r(null)));
  let id = 0;
  const pending = new Map();
  const errs: string[] = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) pending.get(m.id)(m.result), pending.delete(m.id);
    if (m.method === 'Runtime.exceptionThrown')
      errs.push(JSON.stringify(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
  };
  const send = (method: string, params?: unknown) =>
    new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:5199/' });
  await new Promise((r) => setTimeout(r, 2000));
  const ev = async (expr: string) => {
    const r = (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })) as any;
    if (r.result?.exceptionDetails) errs.push('EVAL: ' + r.result.exceptionDetails.text);
    return r.result?.value;
  };

  const r = await ev(`new Promise(res => {
    document.querySelector('.view-tabs button[data-view="scene"]').click();
    setTimeout(() => {
      const c = document.getElementById('sceneCanvas');
      let gl = null;
      try { gl = c.getContext('webgl2'); } catch(e) { res({error: String(e)}); return; }
      res({ hasGL: !!gl, w: c.width, h: c.height, err: gl?.getError?.() });
    }, 1000);
  })`);
  console.log('scene:', JSON.stringify(r));
  console.log('errors:', JSON.stringify(errs, null, 2));
  ws.close();
  process.exit(errs.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
