import type { Project, WorkshopEntry } from './types';

/** Ordered, bounded references to the already-scrubbed activity/reasoning channel. */
export function recordWorkshop(project: Project, entry: WorkshopEntry) {
  project.workshop = [
    ...(project.workshop ?? legacyEntries(project)).filter((item) => item.id !== entry.id),
    entry,
  ].slice(-100);
}

type WorkshopItem = {
  id: string;
  type: 'activity' | 'reasoning';
  text: string;
  truncated: boolean;
};

function legacyEntries(project: Project): WorkshopEntry[] {
  return [
    ...(project.reasoning ?? []).map((block) => ({ id: block.id, type: 'reasoning' as const })),
    ...project.activity.map((text, i) => ({ id: `legacy-${i}`, type: 'activity' as const, text })),
  ];
}

export function workshopEntries(project: Project): WorkshopItem[] {
  const entries = project.workshop ?? legacyEntries(project);
  return entries.flatMap<WorkshopItem>((entry) => {
    if (entry.type === 'activity') return [{ ...entry, truncated: false }];
    const block = project.reasoning?.find((block) => block.id === entry.id);
    return block ? [{ ...entry, text: block.text, truncated: !!block.truncated }] : [];
  });
}

/** Tail, not the start of a growing paragraph: visible progress as updates arrive. */
export function workshopTail(project: Project) {
  return workshopEntries(project)
    .flatMap((entry) => {
      const words = entry.text.replace(/\s+/g, ' ').trim().split(' ');
      const lines: string[] = [];
      let line = '';
      for (const word of words) {
        if (line && line.length + word.length > 100) {
          lines.push(line);
          line = '';
        }
        line += (line ? ' ' : '') + word;
      }
      if (line) lines.push(line);
      return lines.map((text) => ({ type: entry.type, text }));
    })
    .slice(-3);
}
