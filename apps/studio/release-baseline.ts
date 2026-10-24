import fs from 'node:fs';
import { readBlob } from 'isomorphic-git';
import { sourceGit } from '../../packages/grasp/src/client';
import { projectSchema } from '../../packages/publish/src/config';
import { checkSource } from '../../packages/publish/src/project';
import { DiagnosticError } from '../../packages/diagnostics/src';
import type { Project } from './types';

/** Choose only a server-recorded, previously published source revision. */
export function releaseBaseline(project: Project) {
  if (project.publication?.lastPublished)
    return project.publication.lastPublished.plan.sourceCommit;
  if (project.publication?.attempt?.status === 'published')
    return project.publication.attempt.review.plan.sourceCommit;
  if (project.merge?.status === 'merged')
    return project.merge.review?.manifest.tags.find((t) => t[0] === 'source-commit')?.[1];
}

export async function releaseFile(root: string, commit: string, path: string, maxBytes: number) {
  try {
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid saved release revision.');
    if (
      path.startsWith('/') ||
      path.includes('\\') ||
      /[\x00-\x1f]/.test(path) ||
      path.split('/').some((p) => !p || p === '.' || p === '..')
    )
      throw new Error('Invalid saved release path.');
    checkSource(path, new Uint8Array());
    const size = Number(await sourceGit(root, ['cat-file', '-s', `${commit}:${path}`]));
    if (!Number.isSafeInteger(size) || size < 1 || size > maxBytes)
      throw new Error('The saved release file exceeds its supported size.');
    const { blob } = await readBlob({ fs, dir: root, oid: commit, filepath: path });
    if (blob.length !== size) throw new Error('The saved release file changed.');
    return blob;
  } catch (cause) {
    throw new DiagnosticError(
      'STUDIO_RELEASE_MEDIA',
      'The previous release file could not be loaded.',
      {
        operation: 'load previous release',
        target: path,
        cause,
        recovery:
          'Retry, or choose new media for this update. The original published release is unchanged.',
      },
    );
  }
}

export async function releaseConfig(root: string, commit: string) {
  return projectSchema.parse(
    JSON.parse(new TextDecoder().decode(await releaseFile(root, commit, 'napplet.json', 16384))),
  );
}
