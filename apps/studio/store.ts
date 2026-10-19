import { Database } from 'bun:sqlite';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  constants,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { DiagnosticError } from '../../packages/diagnostics/src';
import type { Project } from './types';
import { reasoningLimits } from './types';

export const localOwner = () => `local:${process.getuid?.() ?? 'default'}`;
const ownerSchema = z.string().regex(/^(?:local:[a-zA-Z0-9_-]{1,64}|nostr:[a-f0-9]{64})$/);
const commit = z.string().regex(/^[a-f0-9]{40}$/);
const record = z
  .object({
    id: z.uuid(),
    title: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    phase: z.enum([
      'idle',
      'preparing',
      'editing',
      'checking',
      'ready',
      'failed',
      'stopped',
      'preparing_release',
      'publishing',
    ]),
    stage: z.string(),
    messages: z.array(
      z.object({
        id: z.uuid(),
        role: z.enum(['user', 'assistant', 'system']),
        text: z.string(),
        at: z.string(),
      }),
    ),
    activity: z.array(z.string()),
    reasoning: z
      .array(
        z.object({
          id: z.string().max(128),
          text: z.string().max(reasoningLimits.characters),
          truncated: z.boolean().optional(),
        }),
      )
      .max(reasoningLimits.blocks)
      .optional(),
    reasoningOlder: z.boolean().optional(),
    checks: z.array(
      z.object({
        name: z.string(),
        state: z.enum(['running', 'passed', 'failed']),
        detail: z.string().optional(),
      }),
    ),
    checkpoints: z.array(z.object({ commit, at: z.string(), label: z.string() })),
    baseline: commit.optional(),
    preview: commit.optional(),
    session: z
      .string()
      .regex(/^ses_[a-zA-Z0-9]+$/)
      .optional(),
    estimatedCost: z.number().finite().nonnegative(),
    steps: z.number().int().nonnegative(),
  })
  .passthrough();
const snapshot = z.object({ version: z.literal(1), projects: z.array(record).max(20) });
export type StudioJob = {
  id: string;
  projectId: string;
  kind: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  startedAt: string;
  finishedAt: string | null;
};
const budget = 64 * 1024 * 1024;
function decode(body: string): Project[] {
  if (Buffer.byteLength(body) > budget)
    throw new DiagnosticError('STUDIO_CAPACITY', 'Studio state exceeds its 64 MiB budget.');
  const state = snapshot.parse(JSON.parse(body));
  if (new Set(state.projects.map((p) => p.id)).size !== state.projects.length)
    throw new DiagnosticError('STUDIO_STATE', 'Duplicate draft IDs in saved studio state.');
  return state.projects as Project[];
}
function ordinaryFile(path: string) {
  try {
    if (!lstatSync(path).isFile())
      throw new DiagnosticError('STUDIO_STATE', 'Studio storage must use ordinary files.', {
        target: path,
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** One owner and one live writer. Git stays on disk; this stores private control state. */
export class StudioStore {
  private db!: Database;
  private lock!: Database;
  private closed = false;
  constructor(
    readonly directory: string,
    readonly owner = localOwner(),
  ) {
    ownerSchema.parse(owner);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, 'studio.sqlite'),
      lockPath = join(directory, 'writer.sqlite');
    ordinaryFile(path);
    ordinaryFile(lockPath);
    try {
      this.lock = new Database(lockPath, { create: true });
      chmodSync(lockPath, 0o600);
      try {
        this.lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');
      } catch {
        throw new DiagnosticError('STUDIO_LOCK', 'Another worker owns this studio directory.', {
          recovery:
            'Stop that studio before opening its workspace. A crashed process releases this lock automatically.',
        });
      }
      this.db = new Database(path, { create: true, strict: true });
      chmodSync(path, 0o600);
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, projectId TEXT NOT NULL, kind TEXT NOT NULL,
          status TEXT NOT NULL, startedAt TEXT NOT NULL, finishedAt TEXT);
        CREATE UNIQUE INDEX IF NOT EXISTS one_running_job ON jobs(status) WHERE status='running';`);
      const meta = (key: string) =>
        this.db
          .query<{ value: string }, [string]>('SELECT value FROM metadata WHERE key=?')
          .get(key)?.value;
      if (meta('version') && meta('version') !== '1')
        throw new DiagnosticError('STUDIO_VERSION', 'Unsupported studio database version.');
      if (meta('owner') && meta('owner') !== owner)
        throw new DiagnosticError(
          'STUDIO_OWNER',
          'This workspace store belongs to a different owner.',
          {
            recovery:
              'Use that owner’s authenticated workspace. Changing the publishing account does not change draft ownership.',
          },
        );
      if (!meta('version')) {
        const legacy = join(directory, 'state.json');
        let projects: Project[] = [];
        if (existsSync(legacy)) {
          ordinaryFile(legacy);
          if (lstatSync(legacy).size > budget)
            throw new DiagnosticError(
              'STUDIO_CAPACITY',
              'Legacy studio state exceeds its import budget.',
            );
          projects = decode(readFileSync(legacy, 'utf8'));
          const backup = join(directory, 'state.legacy-v1.json');
          ordinaryFile(backup);
          if (!existsSync(backup)) copyFileSync(legacy, backup, constants.COPYFILE_EXCL);
          chmodSync(backup, 0o600);
        }
        this.db.transaction(() => {
          this.db.run('INSERT INTO metadata VALUES (?,?)', ['version', '1']);
          this.db.run('INSERT INTO metadata VALUES (?,?)', ['owner', owner]);
          this.db.run('INSERT INTO state VALUES (1,?)', [JSON.stringify({ version: 1, projects })]);
        })();
      }
    } catch (error) {
      this.db?.close();
      this.lock?.close();
      throw error;
    }
  }
  load(): Project[] {
    const row = this.db.query<{ body: string }, []>('SELECT body FROM state WHERE id=1').get();
    if (!row) throw new DiagnosticError('STUDIO_STATE', 'The studio database has no saved state.');
    return decode(row.body);
  }
  private write(projects: Project[]) {
    const body = JSON.stringify({
      version: 1,
      projects: projects.map(({ previewUrl: _, ...p }) => p),
    });
    decode(body);
    this.db.run('UPDATE state SET body=? WHERE id=1', [body]);
  }
  save(projects: Project[]) {
    this.db.transaction(() => this.write(projects))();
  }
  recover(projects: Project[]) {
    this.db.transaction(() => {
      this.write(projects);
      this.db.run("UPDATE jobs SET status='interrupted',finishedAt=? WHERE status='running'", [
        new Date().toISOString(),
      ]);
    })();
  }
  begin(projects: Project[], projectId: string): string {
    const p = projects.find((p) => p.id === projectId);
    if (!p) throw new DiagnosticError('STUDIO_PROJECT', 'Draft not found.');
    const id = crypto.randomUUID();
    this.db.transaction(() => {
      this.write(projects);
      this.db.run('INSERT INTO jobs VALUES (?,?,?,?,?,NULL)', [
        id,
        projectId,
        p.phase,
        'running',
        new Date().toISOString(),
      ]);
    })();
    return id;
  }
  finish(
    projects: Project[],
    id: string,
    status: Exclude<StudioJob['status'], 'running' | 'interrupted'>,
  ) {
    this.db.transaction(() => {
      this.write(projects);
      const result = this.db.run(
        "UPDATE jobs SET status=?,finishedAt=? WHERE id=? AND status='running'",
        [status, new Date().toISOString(), id],
      );
      if (result.changes !== 1)
        throw new DiagnosticError('STUDIO_JOB', 'The active job record changed unexpectedly.');
      this.db.run(
        'DELETE FROM jobs WHERE id NOT IN (SELECT id FROM jobs ORDER BY startedAt DESC,id DESC LIMIT 100)',
      );
    })();
  }
  jobs(): StudioJob[] {
    return this.db
      .query<StudioJob, []>('SELECT * FROM jobs ORDER BY startedAt DESC,id DESC LIMIT 100')
      .all();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
    this.lock.close();
  }
}
