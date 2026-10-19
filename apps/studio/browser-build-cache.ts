import {
  browserBuildLimits as limits,
  type BrowserBuildJob,
  type BrowserBuildTransfer,
} from './browser-build-contract';

export function browserBuildDelta(
  job: BrowserBuildJob,
  base: BrowserBuildJob,
): BrowserBuildTransfer {
  return {
    id: job.id,
    revision: job.revision,
    base: base.id,
    files: Object.fromEntries(
      Object.entries(job.files).filter(([path, text]) => base.files[path] !== text),
    ),
    removed: Object.keys(base.files).filter((path) => !Object.hasOwn(job.files, path)),
  };
}

/** One bounded snapshot, kept only in the worker, never in persistent browser storage. */
export class BrowserBuildCache {
  private job?: BrowserBuildJob;

  apply(transfer: BrowserBuildTransfer): BrowserBuildJob {
    if (transfer.base && transfer.base !== this.job?.id)
      throw new Error('Browser compiler cache expired. Run checks again to send a fresh snapshot.');
    const files = Object.assign(
      Object.create(null),
      transfer.base ? this.job!.files : {},
      transfer.files,
    );
    for (const path of transfer.removed ?? []) delete files[path];
    if (
      Object.keys(files).length > limits.files ||
      new TextEncoder().encode(JSON.stringify(files)).length > limits.inputBytes
    )
      throw new Error('Browser compiler input exceeds its file or byte limit. Use soyLI checks.');
    this.job = { id: transfer.id, revision: transfer.revision, files };
    return this.job;
  }
}
