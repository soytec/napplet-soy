import type { ExportFile } from './filesystem';
import { shellActivity } from './shell-ui';

/** Share the same explicit download affordance in the shell and soyLI preview.
 * FS writes may be chunked: say available, never claim an OS save or final write. */
export function fileDownloads(container: HTMLElement) {
  let urls: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let notice: ReturnType<typeof shellActivity> | undefined;
  let revisions = new Map<string, string | Blob>();
  const clear = () => {
    clearTimeout(timer);
    notice?.dismiss();
    urls.forEach((url) => URL.revokeObjectURL(url));
    urls = [];
    container.replaceChildren();
  };
  return {
    update(files: ExportFile[]) {
      const changed = files.filter((f) => revisions.get(f.name) !== (f.revision ?? f.blob));
      if (
        !changed.length &&
        files.length === revisions.size &&
        files.every((f) => revisions.has(f.name))
      )
        return;
      revisions = new Map(files.map((f) => [f.name, f.revision ?? f.blob]));
      clear();
      const links = files.map((file) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file.blob);
        urls.push(a.href);
        a.download = file.name.split('/').pop() || 'download';
        a.textContent = `Download ${a.download}`;
        container.append(a);
        return a;
      });
      const latest = changed.at(-1);
      if (!latest) return;
      const a = links[files.indexOf(latest)];
      timer = setTimeout(() => {
        notice = shellActivity(
          `${a.download} is available. Download it before closing this napplet.`,
          undefined,
          {
            label: 'Download',
            run: () => a.click(),
          },
        );
        notice.success(`${a.download} is available to download.`);
      }, 400);
    },
    close() {
      clear();
      revisions.clear();
    },
  };
}
