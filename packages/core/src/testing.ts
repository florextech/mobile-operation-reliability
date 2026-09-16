import type { ExecutionResult, VerificationResult } from './operation.js';
import type { TransportContext, TransportPort, TransportResponse } from './ports.js';

/** Deterministic in-memory TransportPort adapter for application and adapter tests. */
export class FakeTransport implements TransportPort {
  readonly calls: TransportContext<'EXECUTING'>[] = [];
  readonly verificationCalls: TransportContext<'VERIFYING'>[] = [];
  constructor(
    private readonly handler: (context: TransportContext<'EXECUTING'>) => Promise<TransportResponse<ExecutionResult>> | TransportResponse<ExecutionResult>,
    private readonly verifier?: (context: TransportContext<'VERIFYING'>) => Promise<TransportResponse<VerificationResult>> | TransportResponse<VerificationResult>,
  ) {}
  async execute(context: TransportContext<'EXECUTING'>): Promise<TransportResponse<ExecutionResult>> {
    this.calls.push(context);
    return this.handler(context);
  }
  async verify(context: TransportContext<'VERIFYING'>): Promise<TransportResponse<VerificationResult>> {
    this.verificationCalls.push(context);
    if (!this.verifier) throw new Error('No fake verifier configured');
    return this.verifier(context);
  }
}
