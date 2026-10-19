import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { openCodeAgent, cleanEnvironment } from './agent';
import { diagnose, formatDiagnostic } from '../../packages/diagnostics/src';

test('real agent process preserves a structured provider failure without exposing its JSONL stream or credential', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-agent-error-'));
  try {
    for (const file of [
      'docs/napplet-space.md',
      'docs/napplet-visual-design.md',
      '.agents/skills/napplet-make/SKILL.md',
      '.agents/skills/napplet-ui/SKILL.md',
      '.agents/skills/napplet-test/SKILL.md',
    ]) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), 'Existing project guidance.');
    }
    const executable = join(root, 'agent');
    await writeFile(
      executable,
      `#!${process.execPath}\nconsole.log(JSON.stringify({type:'reasoning',part:{text:'PRIVATE_STREAM_MARKER'}}));console.log(JSON.stringify({type:'error',error:{data:{message:'Provider HTTP 429: test-provider-secret'}}}));process.exit(1);\n`,
      { mode: 0o700 },
    );
    const agent = await openCodeAgent({
      directory: join(root, 'control'),
      executable,
      model: 'deepseek/fixture',
      key: 'test-provider-secret',
      env: cleanEnvironment(),
    });
    let failure: unknown;
    try {
      await agent.run(root, 'Make a game', undefined, new AbortController().signal, () => {});
    } catch (error) {
      failure = error;
    }
    const diagnostic = diagnose(failure);
    expect(diagnostic.code).toBe('STUDIO_AGENT');
    const message = formatDiagnostic(diagnostic);
    expect(message).toContain('Provider HTTP 429');
    expect(message).not.toContain('test-provider-secret');
    expect(message).not.toContain('PRIVATE_STREAM_MARKER');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
