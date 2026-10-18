import { useEffect, useState } from 'react';
import { GitFork, Copy, Check } from 'lucide-react';
import { Button } from './ui/button';
import { remixCommand } from '@/lib/creator-commands';
import { StudioLink } from './studio-link';
import { studioCreatePath } from '../../../studio/navigation';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';

export function RemixButton({ revision, title }: { revision: string; title: string }) {
  const [copied, setCopied] = useState(''),
    [error, setError] = useState('');
  const [origin, setOrigin] = useState('https://napplet.soy');
  useEffect(() => setOrigin(location.origin), []);
  const source = `${origin}/r/${revision}`;
  const commands = [
    {
      id: 'install',
      label: 'Install and remix',
      command: remixCommand(source),
    },
    {
      id: 'installed',
      label: 'Already have the CLI?',
      command: remixCommand(source, false),
    },
  ];
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button data-tone="lilac" data-effect="remix">
          <GitFork size={16} /> Remix this
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Make {title} your own</DialogTitle>
          <DialogDescription>
            Start from this exact version. Your remix gets its own identity and keeps credit for the
            original.
          </DialogDescription>
        </DialogHeader>
        <div className="remix-browser-choice">
          <h3>Remix in your browser</h3>
          <p className="muted">
            Open this version in the local Studio, describe your changes and try the preview.
            Nothing starts until you send your first prompt.
          </p>
          <StudioLink
            path={studioCreatePath(source, `Remix of ${title}`)}
            className="creation-choice-action"
          >
            Remix in browser →
          </StudioLink>
        </div>
        <h3>Or use soyLI locally</h3>
        {commands.map(({ id, label, command }) => (
          <div key={id}>
            <p className="muted">{label}</p>
            <div className="remix-command">
              <code>{command}</code>
              <Button
                variant="outline"
                size="icon"
                aria-label={`Copy ${id === 'install' ? 'install and remix' : 'remix'} command`}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(command);
                    setCopied(id);
                    setError('');
                  } catch {
                    setError('Select the command to copy it.');
                  }
                }}
              >
                {copied === id ? <Check size={16} /> : <Copy size={16} />}
              </Button>
            </div>
          </div>
        ))}
        <p className="muted">
          No website account, Bun or Node installation needed. Run a command in your terminal, then
          open the new folder in your coding agent. Source and license files are preserved when the
          author provides an archive; otherwise the verified HTML is your starting point.
        </p>
        <a href="/cli">Install the CLI ↗</a>
        {error && <p role="status">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
