import { expect, test } from 'bun:test';
import { browserEngine } from '../../apps/cli/src/browser';
import { verifiedDocument, PLAYER_SANDBOX } from '../../packages/runtime/src';
import { nappletPrelude } from '../../packages/runtime/src/prelude';
import { sha256 } from '../../packages/protocol/src';

// Exercise the shipped bundle in a real opaque-origin frame. A closure alone
// cannot hide a port if later calls resolve browser methods/getters from the app.
for (const domain of ['identity', 'llm'] as const)
  for (const hook of ['send', 'receive'] as const)
    test(`the injected ${domain} port stays private when napplet code replaces the ${hook} intrinsic`, async () => {
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: () =>
          new Response('<!doctype html><body></body>', {
            headers: { 'content-type': 'text/html', 'content-security-policy': "frame-src 'self'" },
          }),
      });
      const browser = await (await browserEngine()).chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        page.setDefaultTimeout(5000);
        const html = new TextEncoder().encode(`<!doctype html><p id="result">waiting</p><script>
        const ports = new Set();
        if (${JSON.stringify(hook)} === 'send') {
          const send = MessagePort.prototype.postMessage;
          MessagePort.prototype.postMessage = function(...args) {
            ports.add(this); return Reflect.apply(send, this, args);
          };
        } else {
          const data = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data').get;
          Object.defineProperty(MessageEvent.prototype, 'data', { configurable: true, get() {
            if (this.currentTarget instanceof MessagePort) ports.add(this.currentTarget);
            return Reflect.apply(data, this, []);
          }});
        }
        const value = ${JSON.stringify(domain)} === 'identity'
          ? napplet.identity.getPublicKey()
          : napplet.llm.select({}).then(model => napplet.llm.generate({handle: model.handle, messages: [{role:'user',content:[{type:'text',text:'test'}]}]}))
            .then(result => result.content[0].text);
        value.then(pubkey => {
          document.querySelector('#result').textContent = pubkey;
          document.body.dataset.leaked = String(ports.size);
          for (const port of ports) port.postMessage({type:'identity.getPublicKey',id:'stolen-port'});
        });
      </script>`);
        const shim = await Bun.file(
          Bun.resolveSync('@napplet/shim/prelude.global', import.meta.dir),
        ).text();
        const document = await verifiedDocument(html, await sha256(html), nappletPrelude(shim));
        await page.goto(String(server.url));
        await page.evaluate(
          ({ document, sandbox }) => {
            const frame = window.document.createElement('iframe');
            (window as any).requests = [];
            (window as any).hellos = 0;
            window.addEventListener('message', (e) => {
              if (e.source !== frame.contentWindow || e.data?.type !== 'napplet.hello') return;
              (window as any).hellos++;
              const port = e.ports[0];
              port.onmessage = (e) => {
                (window as any).requests.push(e.data);
                if (e.data.type === 'identity.getPublicKey')
                  port.postMessage({
                    type: 'identity.getPublicKey.result',
                    id: e.data.id,
                    pubkey: 'a'.repeat(64),
                  });
              };
              const original = port.onmessage;
              port.onmessage = (e) => {
                original?.call(port, e);
                if (e.data.type === 'llm.select')
                  port.postMessage({
                    type: 'llm.select.result',
                    id: e.data.id,
                    model: { handle: 'fixture' },
                  });
                if (e.data.type === 'llm.generate')
                  port.postMessage({
                    type: 'llm.generate.result',
                    id: e.data.id,
                    result: { content: [{ type: 'text', text: 'a'.repeat(64) }], finish: 'stop' },
                  });
              };
              port.start();
            });
            frame.setAttribute('sandbox', sandbox);
            frame.srcdoc = document;
            window.document.body.append(frame);
          },
          { document, sandbox: PLAYER_SANDBOX },
        );
        const frame = page.frameLocator('iframe');
        await page.waitForFunction(() => window.document.querySelector('iframe') !== null);
        await frame.locator('body[data-leaked]').waitFor();
        expect(await frame.locator('#result').textContent()).toBe('a'.repeat(64));
        expect(await frame.locator('body').getAttribute('data-leaked')).toBe('0');
        const state = await page.evaluate(() => ({
          hellos: (window as any).hellos,
          requests: (window as any).requests,
        }));
        expect(state.hellos).toBe(1);
        expect(
          state.requests.filter(
            (m: any) => m.type === (domain === 'llm' ? 'llm.generate' : 'identity.getPublicKey'),
          ),
        ).toHaveLength(1);
        expect(state.requests.some((m: any) => m.id === 'stolen-port')).toBe(false);
      } finally {
        await browser.close();
        server.stop(true);
      }
    }, 15000);
