/**
 * Kastle Wallet Integration
 * 
 * Provides interface to interact with the Kastle browser extension wallet
 * Based on: https://github.com/forbole/kastle/blob/main/api/browser.ts
 */

import { CONFIG } from './config';

export interface KastleAccount {
  address: string;
  publicKey: string;
}

export interface ScriptOption {
  inputIndex: number;
  sigHashType?: number;
  scriptData?: Uint8Array;
}

export interface KastleWallet {
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  getAccount(): Promise<KastleAccount>;
  signMessage(message: string): Promise<string>;
  sendKaspa(
    toAddress: string,
    sompi: number,
    options?: { priorityFee?: number; payload?: string }
  ): Promise<string>;
  signTx(
    networkId: 'mainnet' | 'testnet-10',
    txJson: string,
    scripts?: ScriptOption[]
  ): Promise<string>;
  signAndBroadcastTx(
    networkId: 'mainnet' | 'testnet-10',
    txJson: string,
    scripts?: ScriptOption[]
  ): Promise<string>;
  request(method: string, args?: unknown): Promise<unknown>;
}

declare global {
  interface Window {
    kastle?: KastleWallet;
  }
}

/**
 * Check if Kastle wallet is installed
 */
export function isKastleInstalled(): boolean {
  return typeof window.kastle !== 'undefined';
}

/**
 * Get the Kastle wallet instance
 */
export function getKastle(): KastleWallet {
  if (!isKastleInstalled()) {
    throw new Error('Kastle wallet is not installed. Please install it from the Chrome Web Store.');
  }
  return window.kastle!;
}

/**
 * Connect to Kastle wallet
 */
export async function connectWallet(): Promise<KastleAccount> {
  const kastle = getKastle();
  
  const connected = await kastle.connect();
  if (!connected) {
    throw new Error('User rejected wallet connection');
  }
  
  const account = await kastle.getAccount();
  return account;
}

/**
 * Verify the connected address belongs to the expected network.
 * kaspa: prefix = mainnet, kaspatest: prefix = testnet-10.
 * Deterministic — no wallet API calls required.
 */
export function verifyNetworkByAddress(address: string): boolean {
  const target = CONFIG.L1.NETWORK_ID;
  if (target === 'mainnet') return address.startsWith('kaspa:');
  return address.startsWith('kaspatest:');
}

/**
 * Attempt to nudge Kastle to the expected network via kas:get_network check.
 * Kastle's RPC returns the exact network ID ('mainnet' | 'testnet-10'),
 * so we can reliably detect mismatches — but the primary gate is address prefix.
 */
export async function ensureNetwork(): Promise<void> {
  // Kastle doesn't expose switchNetwork; nothing to force here.
  // Verification is handled by verifyNetworkByAddress in handleConnect.
}

/**
 * Disconnect Kastle wallet.
 */
export async function disconnectWallet(): Promise<void> {
  try {
    const kastle = getKastle();
    await kastle.disconnect();
  } catch {
    // Wallet may already be disconnected
  }
}

/**
 * Send KAS with payload using Kastle wallet
 * 
 * @param toAddress - Destination Kaspa address
 * @param sompi - Amount in SOMPI (1 KAS = 100,000,000 SOMPI)
 * @param payload - Hex-encoded payload data
 * @returns Transaction ID
 */
export async function sendKaspaWithPayload(
  toAddress: string,
  sompi: bigint,
  payload: string
): Promise<string> {
  const kastle = getKastle();
  
  // Kastle's sendKaspa expects number for sompi
  // For large amounts, we need to ensure it fits
  const sompiNumber = Number(sompi);
  if (!Number.isSafeInteger(sompiNumber)) {
    throw new Error('Amount too large for safe integer conversion');
  }
  
  const txId = await kastle.sendKaspa(toAddress, sompiNumber, {
    payload: payload,
  });
  
  return txId;
}

/**
 * Sign a message with Kastle wallet
 */
export async function signMessage(message: string): Promise<string> {
  const kastle = getKastle();
  return kastle.signMessage(message);
}

/**
 * Sign a transaction using Kastle wallet
 * 
 * @param txJson - Serialized transaction JSON from WASM SDK
 * @returns Signed transaction JSON
 */
export async function signTransaction(txJson: string): Promise<string> {
  const kastle = getKastle();
  const networkId = CONFIG.L1.NETWORK_ID as 'mainnet' | 'testnet-10';
  return kastle.signTx(networkId, txJson);
}

/**
 * Sign and broadcast a transaction using Kastle wallet
 * 
 * @param txJson - Serialized transaction JSON from WASM SDK
 * @returns Transaction ID
 */
export async function signAndBroadcastTransaction(txJson: string): Promise<string> {
  const kastle = getKastle();
  const networkId = CONFIG.L1.NETWORK_ID as 'mainnet' | 'testnet-10';
  return kastle.signAndBroadcastTx(networkId, txJson);
}
