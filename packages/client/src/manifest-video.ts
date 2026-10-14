import { sha256 } from '../../protocol/src';
import { inspectPreviewVideo, MAX_VIDEO_BYTES } from '../../protocol/src/preview-video';
import { downloadBytes } from './bytes';

/** Verify optional direct-manifest media before handing bytes to the browser decoder. */
export async function manifestVideoBlob(sources: string[], hash: string, signal: AbortSignal) {
  for (const source of sources) {
    signal.throwIfAborted();
    try {
      const bytes = await downloadBytes(source, signal, MAX_VIDEO_BYTES);
      if ((await sha256(bytes)) !== hash) throw new Error('Preview hash mismatch');
      inspectPreviewVideo(bytes);
      signal.throwIfAborted();
      return URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'video/webm' }));
    } catch {
      if (signal.aborted) throw signal.reason;
    }
  }
  throw new Error('No declared Blossom server returned the verified preview clip.');
}
