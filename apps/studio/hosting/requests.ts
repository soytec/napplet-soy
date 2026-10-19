import { Database } from 'bun:sqlite';
import { DiagnosticError } from '../../../packages/diagnostics/src';

/** Write-ahead request receipts prevent an ambiguous disconnect from spending twice.
 * Only input hashes and safe outcomes are stored; prompts and keys are excluded. */
export class StudioRequests {
  private db: Database;
  private running = new Map<string, Promise<unknown>>();
  constructor(path = ':memory:') {
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, hash TEXT NOT NULL, created INTEGER NOT NULL, result TEXT)',
    );
  }
  async run(
    owner: string,
    id: string,
    created: number,
    hash: string,
    action: () => Promise<unknown>,
  ) {
    const now = Date.now();
    if (!Number.isSafeInteger(created) || created < now - 86400000 || created > now + 30000)
      throw new DiagnosticError(
        'STUDIO_REQUEST_EXPIRED',
        'This action expired. Inspect the draft before starting another action.',
      );
    const key = owner + ':' + id;
    this.db.query('DELETE FROM requests WHERE created < ?').run(now - 86400000);
    const row = this.db.query('SELECT hash, result FROM requests WHERE id = ?').get(key) as {
      hash: string;
      result: string | null;
    } | null;
    if (row) {
      if (row.hash !== hash)
        throw new DiagnosticError('STUDIO_REPLAY', 'Request ID already used for different input.');
      const running = this.running.get(key);
      if (running) return running;
      if (row.result) return JSON.parse(row.result);
      throw new DiagnosticError(
        'STUDIO_UNCERTAIN',
        'The host restarted during this action. Inspect the draft and publication status before retrying.',
      );
    }
    if (
      (this.db.query('SELECT COUNT(*) AS count FROM requests').get() as { count: number }).count >=
      100000
    )
      throw new DiagnosticError(
        'STUDIO_CAPACITY',
        'The host request journal is full. Try again later.',
      );
    this.db.query('INSERT INTO requests VALUES (?, ?, ?, NULL)').run(key, hash, created);
    const promise = Promise.resolve()
      .then(action)
      .then((result) => {
        this.db
          .query('UPDATE requests SET result = ? WHERE id = ?')
          .run(JSON.stringify(result), key);
        return result;
      })
      .finally(() => this.running.delete(key));
    this.running.set(key, promise);
    return promise;
  }
  async drain() {
    await Promise.allSettled(this.running.values());
  }
  close() {
    this.db.close();
  }
}
