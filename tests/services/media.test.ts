import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { previewAssets } from '../../apps/cli/src/preview/assets';
import { startPreviewServer } from '../../apps/cli/src/preview/server';

function wav() {
  const rate = 8000,
    samples = rate * 10,
    bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    bytes.writeInt16LE(Math.round(Math.sin((i * 440 * Math.PI * 2) / rate) * 1200), 44 + i * 2);
  return bytes;
}

test('the real shim plays audio in CLI preview, retries a denied gesture and cleans up on identity change', async () => {
  const root = await mkdtemp(join(tmpdir(), 'napplet-media-'));
  let server: ReturnType<typeof startPreviewServer> | undefined;
  const browser = await chromium.launch({ headless: true });
  try {
    await Bun.write(
      join(root, 'napplet.json'),
      JSON.stringify({ previewId: crypto.randomUUID(), entry: 'index.html', requires: ['media'] }),
    );
    await Bun.write(join(root, 'index.html'), '<!doctype html><p>Media fixture</p>');
    server = startPreviewServer(pathToFileURL(root + '/'), 0, false, await previewAssets());
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    await page.addInitScript(() => {
      const Original = window.Audio;
      (window as any).players = [];
      (window as any).denyOnce = true;
      (window as any).Audio = function (...args: any[]) {
        const audio = new Original(...args),
          play = audio.play.bind(audio);
        audio.play = () => {
          if ((window as any).denyOnce) {
            (window as any).denyOnce = false;
            return Promise.reject(new DOMException('Gesture required', 'NotAllowedError'));
          }
          return play();
        };
        (window as any).players.push(audio);
        return audio;
      };
      (window as any).nostr = { getPublicKey: async () => 'b'.repeat(64) };
    });
    await page.route('https://audio.example/fixture.wav', (route) =>
      route.fulfill({
        contentType: 'audio/wav',
        body: wav(),
        headers: { 'access-control-allow-origin': '*' },
      }),
    );
    await page.goto(String(server.url));
    await page.frameLocator('iframe').getByText('Media fixture').waitFor();
    const frame = page.frames().find((f) => f.parentFrame())!;
    const result = await frame.evaluate(async () => {
      const media = (window as any).napplet.media;
      await (window as any).napplet.shell.ready();
      (window as any).mediaStates = [];
      const result = await media.createSession({
        owner: 'shell',
        sessionId: 'hint',
        source: { url: 'https://audio.example/fixture.wav' },
        metadata: { title: 'Fixture' },
      });
      media.onState(result.sessionId, (state: unknown) => (window as any).mediaStates.push(state));
      (window as any).audioSession = result.sessionId;
      media.sendCommand(result.sessionId, 'play');
      return result;
    });
    expect(result.owner).toBe('shell');
    expect(result.sessionId).not.toBe('hint');
    await page.getByRole('button', { name: 'Play audio', exact: true }).click();
    await page.waitForFunction(() => (window as any).players[0]?.currentTime > 0.2);
    await frame.waitForFunction(() =>
      (window as any).mediaStates.some((s: any) => s.status === 'playing'),
    );
    await frame.evaluate(() =>
      (window as any).napplet.media.sendCommand((window as any).audioSession, 'pause'),
    );
    await page.waitForFunction(() => (window as any).players[0]?.paused);
    await page.getByRole('slider', { name: 'Audio volume: Fixture' }).fill('0.35');
    expect(await page.evaluate(() => (window as any).players[0].volume)).toBeCloseTo(0.35);
    await page.getByRole('button', { name: 'Play audio: Fixture' }).click();
    await page.waitForFunction(() => !(window as any).players[0]?.paused);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: '/tmp/napplet-media-mobile.png' });
    await page.getByRole('button', { name: 'Connect browser extension' }).click();
    await page.waitForFunction(() =>
      (window as any).players.every((a: any) => a.paused && !a.getAttribute('src')),
    );
    expect(page.frames()).toContain(frame);
    expect(await page.locator('.nap-media-session').count()).toBe(0);
    // A new account must not revive the old canonical session.
    await frame.evaluate(() =>
      (window as any).napplet.media.sendCommand((window as any).audioSession, 'play'),
    );
    expect(await page.evaluate(() => (window as any).players.every((a: any) => a.paused))).toBe(
      true,
    );
    const rejected = await frame.evaluate(() =>
      (window as any).napplet.media.createSession({ owner: 'invalid' }),
    );
    expect(rejected.error).toBe('invalid media request');
  } finally {
    await browser.close();
    server?.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 60000);

test('napplet-owned Web Audio uses the real shim and honors host controls and account retirement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'napplet-owned-media-'));
  let server: ReturnType<typeof startPreviewServer> | undefined;
  const browser = await chromium.launch({ headless: true });
  try {
    await Bun.write(
      join(root, 'napplet.json'),
      JSON.stringify({
        previewId: crypto.randomUUID(),
        entry: 'index.html',
        requires: ['media'],
      }),
    );
    await Bun.write(
      join(root, 'index.html'),
      `<!doctype html><button id="sound">Enable sound</button>
      <script>
      sound.onclick = async () => {
        const ctx = new AudioContext();
        const gain = ctx.createGain(); gain.gain.value = 0.25; gain.connect(ctx.destination);
        window.audioContext = ctx; window.master = gain;
        await ctx.resume();
        try {
          const media = window.napplet.media;
          const {sessionId, error} = await media.createSession({owner:'napplet',
            capabilities:['play','pause','stop','volume'], metadata:{title:'Game sound'}});
          if (error || !sessionId) throw new Error(error || 'No session');
          window.audioSession = sessionId;
          const tone = ctx.createOscillator(); tone.connect(gain); tone.start();
          const report = () => media.reportState(sessionId, {
            status:ctx.state === 'running' ? 'playing' : 'paused', volume:gain.gain.value});
          media.onCommand(sessionId, async (action,value) => {
            if (action === 'play') await ctx.resume();
            if (action === 'pause' || action === 'stop') await ctx.suspend();
            if (action === 'volume') gain.gain.value = value;
            report();
          });
          report(); sound.disabled = true;
        } catch (error) { await ctx.close(); document.body.append(String(error)); }
      };
      </script>`,
    );
    server = startPreviewServer(pathToFileURL(root + '/'), 0, false, await previewAssets());
    const page = await browser.newPage();
    await page.addInitScript(() => {
      (window as any).nostr = { getPublicKey: async () => 'b'.repeat(64) };
    });
    await page.goto(String(server.url));
    await page.frameLocator('iframe').getByRole('button', { name: 'Enable sound' }).click();
    const frame = page.frames().find((f) => f.parentFrame())!;
    await page.getByRole('button', { name: 'Pause audio: Game sound', exact: true }).click();
    await frame.waitForFunction(() => (window as any).audioContext.state === 'suspended');
    await page.getByRole('slider', { name: 'Audio volume: Game sound' }).fill('0.35');
    await frame.waitForFunction(() => Math.abs((window as any).master.gain.value - 0.35) < 0.001);
    await page.getByRole('button', { name: 'Play audio: Game sound', exact: true }).click();
    await frame.waitForFunction(() => (window as any).audioContext.state === 'running');
    await page.getByRole('button', { name: 'Connect browser extension' }).click();
    await frame.waitForFunction(() => (window as any).audioContext.state === 'suspended');
    await page.locator('.nap-media-session').waitFor({ state: 'detached' });
    await frame.evaluate(() =>
      (window as any).napplet.media.reportState((window as any).audioSession, {
        status: 'playing',
        volume: 1,
      }),
    );
    expect(await page.locator('.nap-media-session').count()).toBe(0);
    expect(await page.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts');
    expect(await frame.evaluate(() => location.origin)).toBe('null');
  } finally {
    await browser.close();
    server?.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
