/** Private, local Studio experiment; not a NAP or publication format. */
export const browserBuildLimits = {
  sourceBytes: 2 * 1024 * 1024,
  inputBytes: 12 * 1024 * 1024,
  outputBytes: 8 * 1024 * 1024,
  files: 512,
  timeoutMs: 120_000,
} as const;
export type BrowserBuildInput = {
  revision: string;
  files: Record<string, string>;
};
export type BrowserBuildJob = BrowserBuildInput & { id: string };
/** A missing base is a complete snapshot. Otherwise files contains only changes. */
export type BrowserBuildTransfer = BrowserBuildJob & { base?: string; removed?: string[] };
export type BrowserBuildResult = {
  id: string;
  revision: string;
  html?: string;
  error?: string;
  errorKind?: 'worker';
  typecheckMs: number;
  buildMs: number;
};
