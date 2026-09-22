import { AppState } from 'react-native';
import * as Network from 'expo-network';
import type { NetworkPort, NetworkState, OperationScheduler, Unsubscribe } from '@florexlabs/mor';

export class ExpoNetworkHint implements NetworkPort {
  private state: NetworkState;
  private readonly listeners = new Set<(state: NetworkState) => void>();
  private readonly subscription: ReturnType<typeof Network.addNetworkStateListener>;
  private constructor(initial: NetworkState) { this.state = initial; this.subscription = Network.addNetworkStateListener(event => this.publish(normalize(event))); }
  static async open(): Promise<ExpoNetworkHint> { return new ExpoNetworkHint(normalize(await Network.getNetworkStateAsync())); }
  getSnapshot(): NetworkState { return this.state; }
  subscribe(listener: (state: NetworkState) => void): Unsubscribe { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  close(): void { this.subscription.remove(); this.listeners.clear(); }
  private publish(next: NetworkState): void { if (next === this.state) return; this.state = next; for (const listener of this.listeners) listener(next); }
}
export function connectLifecycle(scheduler: OperationScheduler): Unsubscribe { const stopNetwork = scheduler.start(); const appState = AppState.addEventListener('change', state => { if (state === 'active') void scheduler.run(); }); return () => { stopNetwork(); appState.remove(); }; }
function normalize(state: Network.NetworkState): NetworkState { return state.isConnected === false || state.isInternetReachable === false ? 'offline' : state.isConnected === true ? 'online' : 'unknown'; }
