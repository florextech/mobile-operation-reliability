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

/** Scripted fault transport for deterministic resilience tests. Each step is
 * consumed once, so tests can reproduce response loss and transient failures. */
export class ChaosTransport implements TransportPort {
  readonly calls: TransportContext<'EXECUTING'>[] = [];
  constructor(private readonly steps: readonly (TransportResponse<ExecutionResult> | Error)[]) {}
  async execute(context: TransportContext<'EXECUTING'>): Promise<TransportResponse<ExecutionResult>> {
    this.calls.push(context);
    const step = this.steps[this.calls.length - 1];
    if (!step) throw new Error('Chaos script exhausted');
    if (step instanceof Error) throw step;
    return step;
  }
}
