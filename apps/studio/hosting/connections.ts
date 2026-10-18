import { Connections, connectionInput } from '../connections';
import { hostedEndpoint } from './inference';

/** The VPS is not the creator's local machine. Never probe its loopback services
 * or send credentials to a user-selected URL, including from connection tests. */
export class HostedConnections extends Connections {
  override async initialize() {
    await super.initialize();
    for (const connection of this.state().connections) hostedEndpoint(connection);
  }
  override async save(value: unknown) {
    const input = connectionInput.parse(value);
    hostedEndpoint(input);
    return super.save(input);
  }
  override async test(id: string) {
    const connection = this.state().connections.find((c) => c.id === id);
    if (!connection) throw new Error('Connection not found.');
    hostedEndpoint(connection);
    return super.test(id);
  }
}
