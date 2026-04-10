/**
 * Shared wallet types for multi-wallet support
 */

export type WalletType = 'kastle' | 'kasware';

export interface ConnectedWallet {
  address: string;
  type: WalletType;
}
