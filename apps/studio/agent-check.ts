import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { diagnose, formatDiagnostic } from '../../packages/diagnostics/src';

/** One invocation, one workspace, one tool. No paths, commands or signer access. */
export async function agentCheckTool(check: (signal: AbortSignal) => Promise<string>) {
  const token = crypto.randomUUID();
  const mcp = new McpServer({ name: 'studio', version: '1.0.0' });
  let checking = false;
  const controller = new AbortController();
  let pending: Promise<string> | undefined;
  mcp.registerTool(
    'check',
    {
      description:
        'Compile and type-check the current draft in the creator’s browser. Use after the first playable edit and after fixes. Returns actual compiler errors; no host build, inference or publication.',
      inputSchema: {},
    },
    async () => {
      if (checking)
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'A check is already running. Wait for its result before editing or checking again.',
            },
          ],
        };
      checking = true;
      try {
        pending = check(controller.signal);
        return { content: [{ type: 'text', text: await pending }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatDiagnostic(diagnose(error)) }],
        };
      } finally {
        checking = false;
      }
    },
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
  });
  await mcp.connect(transport);
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 150,
    maxRequestBodySize: 16384,
    fetch(request) {
      const url = new URL(request.url);
      if (
        url.origin !== server.url.origin ||
        url.pathname !== '/mcp' ||
        request.headers.has('Origin') ||
        request.headers.get('Authorization') !== `Bearer ${token}`
      )
        return new Response('Forbidden', { status: 403 });
      return transport.handleRequest(request);
    },
  });
  return {
    config: {
      type: 'remote' as const,
      url: server.url.origin + '/mcp',
      enabled: true,
      oauth: false as const,
      timeout: 150000,
      headers: { Authorization: `Bearer ${token}` },
    },
    async close() {
      controller.abort();
      await pending?.catch(() => {});
      await server.stop(true);
      await mcp.close();
    },
  };
}
