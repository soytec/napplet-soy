import { Connections, connectionInput } from '../connections';
import { hostedEndpoint } from './inference';
import { connectionVault } from './vault';

/** The VPS is not the creator's local machine. Never probe its loopback services
 * or send credentials to a user-selected URL, including from connection tests. */
export class HostedConnections extends Connections {
  constructor(directory: string, owner: string, masterKey: Uint8Array) {
    super(directory, connectionVault(masterKey, owner));
  }
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
  override async models(value: unknown) {
    // Unsaved model discovery is a network operation too. Validate before the
    // base class can select a saved credential or contact the requested URL.
    const input = connectionInput
      .pick({ id: true, provider: true, endpoint: true, key: true })
      .parse(value);
    hostedEndpoint(input);
    return super.models(input);
  }
}
