/**
 * Kasware Wallet Integration
 *
 * Provides interface to interact with the Kasware browser extension wallet.
 * Based on: https://docs.kasware.xyz/wallet/dev-base/kaspa
 */

import { CONFIG } from './config';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface KaswareWallet {
  requestAccounts(): Promise<string[]>;
  getAccounts(): Promise<string[]>;
  getPublicKey(): Promise<string>;
  getNetwork(): Promise<string | number>;
  switchNetwork(network: string): Promise<void>;
  disconnect(origin: string): Promise<void>;
  getBalance(): Promise<{ confirmed: number; unconfirmed: number; total: number }>;
  sendKaspa(
    toAddress: string,
    sompi: number,
    options?: { priorityFee?: number; payload?: string }
  ): Promise<string>;
  signPskt(params: {
    txJsonString: string;
    options: {
      signInputs: Array<{ index: number; sighashType: number }>;
    };
  }): Promise<string>;
  pushTx(signedTx: string): Promise<string>;
  signMessage(msg: string, options?: { type?: string; noAuxRand?: boolean }): Promise<string>;
}

declare global {
  interface Window {
    kasware?: KaswareWallet;
  }
}

export function isKaswareInstalled(): boolean {
  return typeof window.kasware !== 'undefined';
}

export function getKasware(): KaswareWallet {
  if (!isKaswareInstalled()) {
    throw new Error('Kasware wallet is not installed. Please install it from https://kasware.xyz');
  }
  return window.kasware!;
}

/**
 * Connect to Kasware wallet.
 * Returns the first account address.
 */
export async function connectWallet(): Promise<string> {
  const kasware = getKasware();

  const accounts = await kasware.requestAccounts();
  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts available. Please check your Kasware wallet.');
  }

  return accounts[0];
}

/**
 * Force Kasware to the correct network via switchNetwork().
 * Kasware's getNetwork() return values are inconsistent across versions,
 * so we match the krc-bridge approach: switch rather than read-and-compare.
 */
export async function verifyNetwork(): Promise<boolean> {
  try {
    const kasware = getKasware();
    const target = CONFIG.L1.NETWORK_ID;
    const kaswareNetwork = target === 'mainnet' ? 'kaspa_mainnet' : 'testnet';
    await kasware.switchNetwork(kaswareNetwork);
    return true;
  } catch {
    return false;
  }
}

/**
 * Send KAS with payload using Kasware wallet.
 * Kasware's sendKaspa API is identical to Kastle's.
 */
export async function sendKaspaWithPayload(
  toAddress: string,
  sompi: bigint,
  payload: string
): Promise<string> {
  const kasware = getKasware();

  const sompiNumber = Number(sompi);
  if (!Number.isSafeInteger(sompiNumber)) {
    throw new Error('Amount too large for safe integer conversion');
  }

  const txId = await kasware.sendKaspa(toAddress, sompiNumber, {
    payload: payload,
  });

  return txId;
}

/**
 * Sign and broadcast a pre-built transaction using Kasware wallet.
 *
 * Kasware requires a two-step process:
 * 1. signPskt — sign each input with SighashType.All (0x01)
 * 2. pushTx  — broadcast the signed transaction
 *
 * @param txJson - Serialized transaction JSON from WASM SDK
 * @param inputCount - Number of inputs that need signing
 * @returns Transaction ID
 */
export async function signAndBroadcastTransaction(
  txJson: string,
  inputCount: number
): Promise<string> {
  const kasware = getKasware();

  const signedTx = await kasware.signPskt({
    txJsonString: txJson,
    options: {
      signInputs: Array.from({ length: inputCount }, (_, i) => ({
        index: i,
        sighashType: 1,
      })),
    },
  });

  return kasware.pushTx(signedTx);
}
