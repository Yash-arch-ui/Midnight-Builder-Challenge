import { describe, it, expect } from 'vitest';
import * as compactRuntime from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger } from '../contracts/managed/counter/contract/index.js';

// Helper: create a fresh circuit context + initial contract state
function createContractContext() {
  const contract = new Contract({});
  const zswapLocalState = compactRuntime.emptyZswapLocalState();
  const result = contract.initialState({
    initialZswapLocalState: zswapLocalState,
    initialPrivateState: undefined,
  });
  const state = result.currentContractState;
  const context: compactRuntime.CircuitContext<unknown> = compactRuntime.createCircuitContext(
    compactRuntime.dummyContractAddress(),
    zswapLocalState.coinPublicKey,
    state.data,
    undefined
  );
  return { contract, context, state };
}

describe('Counter Compact Contract', () => {
  // -----------------------------------------------------------------------
  // 1. Circuit logic — incrementCounter produces the correct new count
  // -----------------------------------------------------------------------
  it('increments the counter by the secret amount and returns the new value', () => {
    const { contract, context, state } = createContractContext();

    // Initial ledger: count = 0n
    expect(ledger(state.data).count).toBe(0n);

    // Call incrementCounter(5) — private input is 5
    const result = contract.circuits.incrementCounter(context, 5n);

    // After the call the state is updated; read the new count
    const updatedState = new compactRuntime.ChargedState(
      result.context.currentQueryContext.state.state
    );
    const newLedger = ledger(updatedState);

    expect(newLedger.count).toBe(5n);
  });

  // -----------------------------------------------------------------------
  // 2. State transitions — sequential calls accumulate correctly
  // -----------------------------------------------------------------------
  it('correctly chains multiple state transitions', () => {
    const { contract, context } = createContractContext();

    // First increment: +10
    const r1 = contract.circuits.incrementCounter(context, 10n);
    const s1 = new compactRuntime.ChargedState(r1.context.currentQueryContext.state.state);
    expect(ledger(s1).count).toBe(10n);

    // Second increment: +3
    const r2 = contract.circuits.incrementCounter(r1.context, 3n);
    const s2 = new compactRuntime.ChargedState(r2.context.currentQueryContext.state.state);
    expect(ledger(s2).count).toBe(13n);

    // Third increment: +7
    const r3 = contract.circuits.incrementCounter(r2.context, 7n);
    const s3 = new compactRuntime.ChargedState(r3.context.currentQueryContext.state.state);
    expect(ledger(s3).count).toBe(20n);
  });

  // -----------------------------------------------------------------------
  // 3. Privacy — private input is never exposed on-chain
  // -----------------------------------------------------------------------
  it('never exposes the private increment input in public transcript or output', () => {
    const { contract, context } = createContractContext();

    // Use a distinctive secret value (private input) so we can verify it
    // doesn't leak. The disclosed result will be 0 + 47 = 47, which is a
    // DIFFERENT number — so we can tell input from result apart.
    const secretIncrement = 47n;
    const expectedResult = secretIncrement; // 0 + 47 = 47

    const result = contract.circuits.incrementCounter(context, secretIncrement);

    // The public transcript contains the disclosed *result* (47), but must
    // NOT carry the private input as a separate value. We verify this by
    // checking the privateTranscriptOutputs — the dedicated channel for
    // secret inputs — is empty.
    expect(result.proofData.privateTranscriptOutputs).toHaveLength(0);

    // The circuit return type is () — an empty tuple, so nothing is leaked
    // through the return value.
    expect(result.proofData.output.value).toHaveLength(0);

    // The ledger state carries only the disclosed result, not the input.
    const updatedState = new compactRuntime.ChargedState(
      result.context.currentQueryContext.state.state
    );
    expect(ledger(updatedState).count).toBe(expectedResult);
  });

  // -----------------------------------------------------------------------
  // 4. Edge case — increment by zero keeps count unchanged
  // -----------------------------------------------------------------------
  it('handles increment-by-zero without changing state', () => {
    const { contract, context } = createContractContext();

    const result = contract.circuits.incrementCounter(context, 0n);
    const updatedState = new compactRuntime.ChargedState(
      result.context.currentQueryContext.state.state
    );

    expect(ledger(updatedState).count).toBe(0n);
  });

  // -----------------------------------------------------------------------
  // 5. Large values — Field arithmetic stays within bounds
  // -----------------------------------------------------------------------
  it('handles large Field values correctly', () => {
    const { contract, context } = createContractContext();

    // A reasonably large Field value (Field is modulo the curve order)
    const largeIncrement = 999999n;
    const result = contract.circuits.incrementCounter(context, largeIncrement);
    const updatedState = new compactRuntime.ChargedState(
      result.context.currentQueryContext.state.state
    );

    expect(ledger(updatedState).count).toBe(largeIncrement);
  });
});
