import { expect, test } from 'bun:test';
import { checkPublication } from '../../apps/cli/src/publish-check';
import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { screenshotProject } from '../../apps/cli/src/project-config';
import { recordingSchema } from '../../packages/publish/src/config';
import { RUNTIME_PROFILE } from '../../packages/runtime/src/capabilities';

test('scripted captures focus keyboard controls, scale portrait clicks and take the cover during play', async () => {
  const config = new TextEncoder().encode(
    JSON.stringify({
      schema: 'space-local-project/v1',
      name: 'Start screen fixture',
      license: 'MIT',
      previewId: crypto.randomUUID(),
      entry: 'index.html',
      preview: { delayMs: 250 },
    }),
  );
  const html = new TextEncoder().encode(`<!doctype html><style>
    html,body{margin:0;width:100%;height:100%;background:rgb(180,20,20)}
    button{position:absolute;left:40%;top:40%;width:20%;height:20%}
    </style><button>Play</button><script>
    const play=()=>{document.body.style.background='rgb(20,180,20)';document.querySelector('button').remove()};
    document.querySelector('button').onclick=play;
    window.addEventListener('keydown',e=>{if(e.code==='Space')play()});
    </script>`);
  for (const portrait of [false, true]) {
    const result = await checkPublication(
      new Map([
        ['napplet.json', config],
        ['index.html', html],
      ]),
      true,
      recordingSchema.parse({
        durationMs: 2000,
        actions: portrait
          ? [{ type: 'click', atMs: 0, x: 480, y: 300 }]
          : [
              { type: 'keyDown', atMs: 0, key: 'Space' },
              { type: 'keyUp', atMs: 100, key: 'Space' },
            ],
      }),
      false,
      undefined,
      portrait ? { width: 360, height: 640 } : undefined,
    );
    const pixel = await sharp(result.preview)
      .extract({ left: 10, top: 10, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect([...pixel]).toEqual([20, 180, 20]);
    expect(result.video?.length).toBeGreaterThan(1000);
  }
}, 45000);

async function checkCli(contents: Map<string, Uint8Array>) {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-startup-check-'));
  try {
    for (const [path, bytes] of contents) await Bun.write(join(directory, path), bytes);
    await Bun.write(join(directory, 'LICENSE'), 'MIT');
    const child = Bun.spawn(
      [
        process.execPath,
        new URL('../../apps/cli/src/index.ts', import.meta.url).pathname,
        'check',
        '--project',
        directory,
        '--json',
      ],
      { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    );
    const timeout = setTimeout(() => child.kill(), 12000);
    try {
      const [code, out, err] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { code, out, err, data: JSON.parse(out) };
    } finally {
      clearTimeout(timeout);
      if (child.exitCode === null) child.kill();
      await child.exited;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test.each([
  [
    'script failures',
    '<!doctype html><script>throw new Error("Broken creation")</script>',
    'Broken creation',
  ],
  [
    'direct networking',
    '<!doctype html><img src="https://must-not-contact.invalid/image.png">',
    'content security policy violation',
  ],
  ['a working isolated creation', '<!doctype html><p>Working creation</p>', null],
])(
  'publication startup checks %s',
  async (_, html, errorMessage) => {
    const config = new TextEncoder().encode(
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Preview check',
        license: 'MIT',
        preview: { delayMs: 250 },
        previewId: crypto.randomUUID(),
        entry: 'index.html',
        requires: [],
        relays: [],
        servers: [],
      }),
    );
    const contents = new Map([
      ['napplet.json', config],
      ['index.html', new TextEncoder().encode(html!)],
    ]);
    // Exercise the same process boundary as a creator, including useful diagnostics.
    const outcome = await checkCli(contents);
    if (errorMessage) {
      expect(outcome.code, outcome.out + outcome.err).toBe(1);
      expect(outcome.data.error).toMatchObject({ code: 'BROWSER_CHECK' });
      expect(outcome.out).toContain(errorMessage);
    } else {
      expect(outcome.code, outcome.out + outcome.err).toBe(0);
      expect(outcome.data).toMatchObject({ profile: RUNTIME_PROFILE });
    }
  },
  15000,
);

test('capture contains the app pixels, saves a selected image, and validates chosen images', async () => {
  const root = await mkdtemp(join(tmpdir(), 'napplet-capture-'));
  try {
    const config = {
      schema: 'space-local-project/v1',
      name: 'Capture',
      previewId: crypto.randomUUID(),
      entry: 'index.html',
      license: 'MIT',
      preview: { delayMs: 250 },
    };
    const html =
      '<!doctype html><style>html,body{margin:0;height:100%;background:rgb(20,100,180)}</style><p style="margin:0">App content</p>';
    await Bun.write(join(root, 'napplet.json'), JSON.stringify(config));
    await Bun.write(join(root, 'index.html'), html);
    await Bun.write(join(root, 'LICENSE'), 'MIT license');
    const result = await screenshotProject(root, 'local');
    const bytes = await Bun.file(result.image).bytes();
    const metadata = await sharp(bytes).metadata();
    expect([metadata.width, metadata.height]).toEqual([1200, 750]);
    const pixel = await sharp(bytes)
      .extract({ left: 1100, top: 700, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect([...pixel]).toEqual([20, 100, 180]);
    expect((await Bun.file(join(root, 'napplet.json')).json()).preview.image).toBe('preview.png');
    await expect(screenshotProject(root, 'local')).rejects.toMatchObject({
      code: 'PREVIEW_EXISTS',
    });
    expect(await Bun.file(result.image).bytes()).toEqual(bytes);
    const selected = new Map([
      ['napplet.json', await Bun.file(join(root, 'napplet.json')).bytes()],
      ['index.html', new TextEncoder().encode(html)],
      ['preview.png', bytes],
    ]);
    expect((await checkPublication(selected)).preview).toEqual(bytes);
    selected.set('preview.png', new TextEncoder().encode('<svg>not a PNG</svg>'));
    await expect(checkPublication(selected)).rejects.toMatchObject({ code: 'PREVIEW_IMAGE' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
