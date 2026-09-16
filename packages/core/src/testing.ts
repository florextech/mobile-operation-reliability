import type { ExecutionResult } from './operation.js';
import type { TransportContext, TransportPort } from './ports.js';

/** Deterministic in-memory TransportPort adapter for application and adapter tests. */
export class FakeTransport implements TransportPort {
  readonly calls: TransportContext<'EXECUTING'>[] = [];
  constructor(private readonly handler: (context: TransportContext<'EXECUTING'>) => Promise<ExecutionResult> | ExecutionResult) {}
  async execute(context: TransportContext<'EXECUTING'>): Promise<ExecutionResult> {
    this.calls.push(context);
    return this.handler(context);
  }
}
