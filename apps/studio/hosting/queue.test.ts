import { test, expect } from 'bun:test';
import { StudioQueue } from './queue';

test('one isolated job runs at a time; queued cancellation never starts inference and capacity is bounded', async () => {
  const started: string[] = [];
  const gates: (() => void)[] = [];
  const queue = new StudioQueue({
    run: async (_files, command) => {
      started.push(command[0]);
      await new Promise<void>((resolve) => gates.push(resolve));
      return { files: {}, output: command[0] };
    },
  });
  const controls = Array.from({ length: 6 }, () => new AbortController());
  const pending = controls
    .slice(0, 5)
    .map((c, i) => queue.run({}, [String(i)], { signal: c.signal, operation: 'test' }));
  const cancelled = pending[2].then(
    () => false,
    () => true,
  );
  await Promise.resolve();
  expect(started).toEqual(['0']);
  await expect(
    queue.run({}, ['5'], { signal: controls[5].signal, operation: 'test' }),
  ).rejects.toMatchObject({ code: 'STUDIO_BUSY' });
  controls[2].abort();
  expect(await cancelled).toBe(true);
  for (const index of [0, 1, 3, 4]) {
    gates.shift()!();
    await pending[index];
    await Promise.resolve();
  }
  expect(started).toEqual(['0', '1', '3', '4']);
  const last = queue.run({}, ['after'], {
    signal: new AbortController().signal,
    operation: 'test',
  });
  await Promise.resolve();
  gates.shift()!();
  await last;
});
