import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { DiagnosticError } from '../../packages/diagnostics/src';
import { fetchModelCatalogue, modelIdPattern } from './model-catalogue';
import {
  defaultSteps,
  providers,
  validEndpoint,
  type Provider,
  type ConnectionInput,
  type ConnectionState,
} from './connections-model';

export const connectionInput = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(60),
    provider: z.enum(Object.keys(providers) as [Provider, ...Provider[]]),
    endpoint: z
      .string()
      .trim()
      .max(2048)
      .refine(validEndpoint, 'Use HTTPS, or HTTP on this computer’s loopback address.'),
    model: z.string().trim().min(1).max(160).regex(modelIdPattern),
    steps: z.number().int().min(10).max(100),
    // Omission keeps the saved key. Empty explicitly clears it for a local server.
    key: z.string().max(4096).optional(),
  })
  .strict();

const catalogueInput = connectionInput.pick({
  id: true,
  provider: true,
  endpoint: true,
  key: true,
});
const modelInput = connectionInput
  .pick({ id: true, model: true })
  .extend({ id: z.uuid(), revision: z.uuid() });

const savedConnection = connectionInput
  .extend({ id: z.uuid(), revision: z.uuid(), key: z.string().max(4096) })
  .strict();
const savedSchema = z
  .object({
    version: z.literal(1),
    selected: z.uuid().optional(),
    connections: z.array(savedConnection).max(24),
  })
  .strict();
type Saved = z.infer<typeof savedSchema>;
export type ConnectionCodec = {
  encode: (value: string) => string;
  decode: (value: string) => string;
};
const fail = (message: string) =>
  new DiagnosticError('STUDIO_CONNECTION', message, {
    operation: 'configure inference connection',
  });

/** Local OS-user credentials, deliberately outside every draft and Git checkout. */
export class Connections {
  private data: Saved = { version: 1, connections: [] };
  private secrets = new Set<string>();
  constructor(
    private directory: string,
    private codec?: ConnectionCodec,
  ) {}
  async initialize(seed?: { key: string; model: string }) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const directoryInfo = await lstat(this.directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink())
      throw fail('Use a real private directory for connections.');
    await chmod(this.directory, 0o700);
    const filename = join(this.directory, 'connections.json');
    try {
      const info = await lstat(filename);
      if (!info.isFile() || info.size > 256 * 1024)
        throw fail('The saved connections file is invalid.');
      const bytes = await readFile(filename, 'utf8');
      this.data = savedSchema.parse(JSON.parse(this.codec ? this.codec.decode(bytes) : bytes));
      await chmod(filename, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw fail(
          'Cannot read saved connections. Restore the private settings file or correct its permissions.',
        );
      if (seed?.key) {
        const id = crypto.randomUUID();
        this.data = {
          version: 1,
          selected: id,
          connections: [
            {
              id,
              revision: crypto.randomUUID(),
              name: 'DeepSeek',
              provider: 'deepseek',
              endpoint: providers.deepseek.url,
              model: seed.model.replace(/^deepseek\//, ''),
              steps: defaultSteps,
              key: seed.key,
            },
          ],
        };
      }
      await this.persist(this.data);
    }
    for (const c of this.data.connections) if (c.key) this.secrets.add(c.key);
  }
  state(): ConnectionState {
    return {
      selected: this.data.selected,
      connections: this.data.connections.map(({ key, ...c }) => ({ ...c, hasKey: !!key })),
    };
  }
  current() {
    const connection = this.data.connections.find((c) => c.id === this.data.selected);
    if (!connection)
      throw fail('Choose an inference connection in Connections before sending a message.');
    return { ...connection };
  }
  get model() {
    const c = this.data.connections.find((c) => c.id === this.data.selected);
    return c ? `${c.name} / ${c.model}` : 'No connection selected';
  }
  get sessionKey() {
    const c = this.current();
    return `${c.id}:${c.revision}`;
  }
  scrub = (value: string) => {
    for (const key of this.secrets) value = value.replaceAll(key, '[provider credential redacted]');
    return value;
  };
  private async persist(next: Saved) {
    const target = join(this.directory, 'connections.json');
    const temporary = join(this.directory, `.connections-${crypto.randomUUID()}`);
    try {
      const bytes = JSON.stringify(next);
      await writeFile(temporary, this.codec ? this.codec.encode(bytes) : bytes, {
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporary, target);
      this.data = next;
    } finally {
      await rm(temporary, { force: true });
    }
  }
  async save(value: ConnectionInput) {
    const parsed = connectionInput.safeParse(value);
    if (!parsed.success)
      throw fail(
        'Invalid connection settings. Check the name, URL, model and step limit (10–100).',
      );
    const input = parsed.data;
    const old = this.data.connections.find((c) => c.id === input.id);
    if (input.id && !old) throw fail('That connection no longer exists.');
    if (!old && this.data.connections.length >= 24)
      throw fail('Keep at most 24 saved connections.');
    if (
      old?.key &&
      input.key === undefined &&
      (input.endpoint !== old.endpoint || input.provider !== old.provider)
    )
      throw fail('Re-enter the API key when changing its destination or provider.');
    const key = input.key ?? old?.key ?? '';
    if (key) this.secrets.add(key);
    if (!key && !['ollama', 'lmstudio', 'llamacpp', 'compatible'].includes(input.provider))
      throw fail('This provider requires an API key.');
    const c = { ...input, key, id: old?.id ?? crypto.randomUUID(), revision: crypto.randomUUID() };
    const connections = old
      ? this.data.connections.map((v) => (v.id === old.id ? c : v))
      : [...this.data.connections, c];
    await this.persist({ version: 1, selected: this.data.selected ?? c.id, connections });
    return this.state();
  }
  async select(id: string) {
    if (!this.data.connections.some((c) => c.id === id)) throw fail('Connection not found.');
    await this.persist({ ...this.data, selected: id });
    return this.state();
  }
  async remove(id: string) {
    if (!this.data.connections.some((c) => c.id === id)) throw fail('Connection not found.');
    await this.persist({
      ...this.data,
      selected: this.data.selected === id ? undefined : this.data.selected,
      connections: this.data.connections.filter((c) => c.id !== id),
    });
    return this.state();
  }
  async models(value: unknown) {
    const parsed = catalogueInput.safeParse(value);
    if (!parsed.success)
      throw fail('Check the provider, API base URL and key before fetching models.');
    const input = parsed.data;
    const old = this.data.connections.find((c) => c.id === input.id);
    if (input.id && !old) throw fail('That connection no longer exists.');
    if (
      old?.key &&
      input.key === undefined &&
      (input.endpoint !== old.endpoint || input.provider !== old.provider)
    )
      throw fail('Re-enter the API key when changing its destination or provider.');
    const key = input.key ?? old?.key ?? '';
    if (key) this.secrets.add(key);
    if (!key && !['ollama', 'lmstudio', 'llamacpp', 'compatible'].includes(input.provider))
      throw fail('Enter an API key before fetching models.');
    // Discovery never saves an edited form, changes the model or starts inference.
    return fetchModelCatalogue({ ...input, key });
  }
  async setModel(value: unknown) {
    const parsed = modelInput.safeParse(value);
    if (!parsed.success) throw fail('Choose a connection and a valid model ID.');
    const { id, model, revision } = parsed.data;
    const c = this.data.connections.find((c) => c.id === id);
    if (!c) throw fail('Connection not found.');
    if (c.revision !== revision)
      throw fail('This connection changed. Reopen the model picker and try again.');
    if (c.model !== model)
      await this.persist({
        ...this.data,
        connections: this.data.connections.map((v) =>
          v.id === id ? { ...v, model, revision: crypto.randomUUID() } : v,
        ),
      });
    return this.state();
  }
  async test(id: string) {
    const c = this.data.connections.find((c) => c.id === id);
    if (!c) throw fail('Connection not found.');
    const { models, truncated } = await this.models({
      id,
      provider: c.provider,
      endpoint: c.endpoint,
    });
    const found = models.some((m) => m.id === c.model || 'models/' + m.id === c.model);
    return {
      message: found
        ? 'Connected. The selected model is listed. Tool calling and image support still depend on the model.'
        : `Connected, but this model was not listed${truncated ? ' in the partial catalogue' : ''}. Verify its exact ID. This test does not run inference.`,
    };
  }
}
