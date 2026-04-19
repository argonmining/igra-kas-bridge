/**
 * Igra Bridge Configuration
 *
 * Configuration for bridging KAS from Kaspa L1 to iKAS on Igra L2.
 * Supports Galleon Testnet, Galleon Test Mainnet, and Igra Mainnet.
 */

import { defineChain, type PublicClient } from 'viem';

export type NetworkMode = 'testnet' | 'test-mainnet' | 'mainnet';

/**
 * Bridge direction. Deposit = KAS (L1) → iKAS (L2). Exit = iKAS (L2) → KAS (L1).
 * Orthogonal to NetworkMode.
 */
export type BridgeMode = 'deposit' | 'exit';

export interface NetworkConfig {
  L1: {
    readonly NETWORK_ID: 'testnet-10' | 'mainnet';
    /** The P2SH address where KAS is locked for bridging. Null means self-send (sender's own address). */
    readonly ENTRY_ADDRESS: string | null;
    readonly TX_ID_PREFIX: string;
    readonly MIN_BRIDGE_AMOUNT_KAS: number;
    readonly MAX_BRIDGE_AMOUNT_KAS: number | null;
    readonly SOMPI_PER_KAS: bigint;
    readonly EXPLORER_BASE: string;
  };
  L2: {
    readonly NETWORK_NAME: string;
    readonly RPC_URL: string;
    readonly CHAIN_ID: number;
    readonly CURRENCY_SYMBOL: string;
    readonly CURRENCY_DECIMALS: number;
    readonly BLOCK_EXPLORER: string;
  };
}

const NETWORKS: Record<NetworkMode, NetworkConfig> = {
  testnet: {
    L1: {
      NETWORK_ID: 'testnet-10',
      ENTRY_ADDRESS: 'kaspatest:qqmstl2znv9tsfgcmj9shme82my867tapz7pdu4ztwdn6sm9452jj5mm0sxzw',
      TX_ID_PREFIX: '97b4',
      MIN_BRIDGE_AMOUNT_KAS: 1,
      MAX_BRIDGE_AMOUNT_KAS: null,
      SOMPI_PER_KAS: 100_000_000n,
      EXPLORER_BASE: 'https://explorer-tn10.kaspa.org',
    },
    L2: {
      NETWORK_NAME: 'Igra Galleon Testnet',
      RPC_URL: 'https://galleon-testnet.igralabs.com:8545',
      CHAIN_ID: 38836,
      CURRENCY_SYMBOL: 'iKAS',
      CURRENCY_DECIMALS: 18,
      BLOCK_EXPLORER: 'https://explorer.galleon.igralabs.com',
    },
  },
  'test-mainnet': {
    L1: {
      NETWORK_ID: 'mainnet',
      ENTRY_ADDRESS: null, // Self-send: KAS goes back to sender's own address
      TX_ID_PREFIX: '97b5',
      MIN_BRIDGE_AMOUNT_KAS: 1,
      MAX_BRIDGE_AMOUNT_KAS: null,
      SOMPI_PER_KAS: 100_000_000n,
      EXPLORER_BASE: 'https://explorer.kaspa.org',
    },
    L2: {
      NETWORK_NAME: 'Igra Galleon Test Mainnet',
      RPC_URL: 'https://galleon.igralabs.com:8545',
      CHAIN_ID: 38837,
      CURRENCY_SYMBOL: 'iKAS',
      CURRENCY_DECIMALS: 18,
      BLOCK_EXPLORER: 'https://explorer.galleon.igralabs.com',
    },
  },
  mainnet: {
    L1: {
      NETWORK_ID: 'mainnet',
      ENTRY_ADDRESS: 'kaspa:ppvnxxzm0rr37zpnwux2f2ntvfpr4uqdpm7zsvsztg3en92r7gs0wkmr72q9n',
      TX_ID_PREFIX: '97b1',
      MIN_BRIDGE_AMOUNT_KAS: parseInt(import.meta.env.VITE_MAINNET_MIN_KAS, 10) || 10,
      MAX_BRIDGE_AMOUNT_KAS: null,
      SOMPI_PER_KAS: 100_000_000n,
      EXPLORER_BASE: 'https://explorer.kaspa.org',
    },
    L2: {
      NETWORK_NAME: 'Igra Mainnet',
      RPC_URL: 'https://rpc.igralabs.com:8545',
      CHAIN_ID: 38833,
      CURRENCY_SYMBOL: 'iKAS',
      CURRENCY_DECIMALS: 18,
      BLOCK_EXPLORER: 'https://explorer.igralabs.com',
    },
  },
};

// Shared constants (same across all networks)
const SHARED = {
  ENTRY_TX: {
    PAYLOAD_PREFIX: 0x92,
    L2_DATA_LENGTH: 28,
    NONCE_LENGTH: 4,
  },
  MINING: {
    MAX_NONCE_ITERATIONS: 10_000_000,
    PROGRESS_INTERVAL: 100_000,
  },
} as const;

// Current network state
let currentMode: NetworkMode = 'mainnet';
let currentBridgeMode: BridgeMode = 'deposit';

/**
 * Get the current network mode
 */
export function getNetworkMode(): NetworkMode {
  return currentMode;
}

/**
 * Set the active network mode
 */
export function setNetworkMode(mode: NetworkMode): void {
  currentMode = mode;
}

/**
 * Get the current bridge direction (deposit or exit).
 */
export function getBridgeMode(): BridgeMode {
  return currentBridgeMode;
}

/**
 * Set the current bridge direction. Exit is only valid when
 * NetworkMode is 'mainnet'; callers must ensure that invariant.
 */
export function setBridgeMode(mode: BridgeMode): void {
  currentBridgeMode = mode;
}

/**
 * Active network config — use this instead of the old CONFIG constant.
 * Returns L1/L2 config for the currently selected network.
 */
export const CONFIG = {
  get L1() { return NETWORKS[currentMode].L1; },
  get L2() { return NETWORKS[currentMode].L2; },
  ENTRY_TX: SHARED.ENTRY_TX,
  MINING: SHARED.MINING,
};

/**
 * Validates an Ethereum-style address (0x prefixed, 40 hex chars)
 */
export function isValidL2Address(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validates a Kaspa address for the current network
 */
export function isValidKaspaAddress(address: string): boolean {
  if (currentMode === 'test-mainnet' || currentMode === 'mainnet') {
    return address.startsWith('kaspa:');
  }
  return address.startsWith('kaspatest:');
}

/**
 * Converts KAS to SOMPI
 */
export function kasToSompi(kas: number): bigint {
  return BigInt(Math.floor(kas * Number(CONFIG.L1.SOMPI_PER_KAS)));
}

/**
 * Converts SOMPI to KAS
 */
export function sompiToKas(sompi: bigint): number {
  return Number(sompi) / Number(CONFIG.L1.SOMPI_PER_KAS);
}

/**
 * Returns the entry address for the current network.
 * For test-mainnet (self-send), requires the sender address.
 */
export function getEntryAddress(senderAddress?: string): string {
  const entry = CONFIG.L1.ENTRY_ADDRESS;
  if (entry !== null) return entry;
  if (!senderAddress) throw new Error('Sender address required for self-send mode');
  return senderAddress;
}

/**
 * Mainnet bridge fee configuration (from env variables).
 * Set VITE_MAINNET_FEE_KAS (whole KAS) and VITE_MAINNET_FEE_ADDRESS in Railway.
 * If either is missing, no fee is applied.
 */
export interface BridgeFee {
  amountSompi: bigint;
  address: string;
}

export function getMainnetFee(): BridgeFee | null {
  if (currentMode !== 'mainnet') return null;

  const feeKas = import.meta.env.VITE_MAINNET_FEE_KAS;
  const feeAddress = import.meta.env.VITE_MAINNET_FEE_ADDRESS;

  if (!feeKas || !feeAddress) return null;

  const kas = parseInt(feeKas, 10);
  if (isNaN(kas) || kas <= 0) return null;

  return {
    amountSompi: BigInt(kas) * 100_000_000n,
    address: feeAddress.trim(),
  };
}

// ───────────────────────────────────────────────────────────────
// Igra Mainnet EVM chain descriptor (used by the Exit flow)
// ───────────────────────────────────────────────────────────────

/**
 * viem Chain descriptor for Igra Mainnet (chain id 38833).
 *
 * This is the single source of truth for EVM-side network params —
 * consumed by src/evm-wallet.ts for PublicClient/WalletClient factories
 * and for wallet_addEthereumChain requests. Field shape mirrors the
 * production krc-bridge config so behaviour is consistent across the
 * broader Argon Labs stack.
 */
export const IGRA_MAINNET_CHAIN = defineChain({
  id: 38833,
  name: 'Igra',
  nativeCurrency: { name: 'iKAS', symbol: 'iKAS', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.igralabs.com:8545'] },
    public: { http: ['https://rpc.igralabs.com:8545'] },
  },
  blockExplorers: {
    default: { name: 'Igra Explorer', url: 'https://explorer.igralabs.com' },
  },
  testnet: false,
});

/**
 * EIP-3085 payload builder for `wallet_addEthereumChain` when an EVM
 * wallet doesn't yet know about Igra Mainnet. Returns a fresh mutable
 * object each call (wallet SDKs often mutate what you pass in).
 */
export function buildIgraAddChainParams() {
  return {
    chainId: '0x97b1',
    chainName: 'Igra',
    nativeCurrency: { name: 'iKAS', symbol: 'iKAS', decimals: 18 },
    rpcUrls: ['https://rpc.igralabs.com:8545'],
    blockExplorerUrls: ['https://explorer.igralabs.com'],
  };
}

export const IGRA_MAINNET_CHAIN_ID_HEX = '0x97b1' as const;

/**
 * 1 iKAS (18 decimals) = 10^8 sompi (8 decimals), i.e. 1 sompi = 10^10 wei.
 * Matches the `SOMPI_SCALE` constant inside the KasExitBridge contract.
 */
export const SOMPI_SCALE_WEI = 10_000_000_000n;

/**
 * Reads and validates the deployed KasExitBridge proxy address from env.
 * Returns null if the variable is missing or malformed — the UI uses that
 * to hide the Withdraw tab gracefully.
 */
export function getExitContractAddress(): `0x${string}` | null {
  const raw = (import.meta.env.VITE_IGRA_EXIT_CONTRACT_ADDRESS ?? '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) return null;
  return raw as `0x${string}`;
}

/**
 * Reads the optional WalletConnect v2 project id. Returns null if unset,
 * which causes the WalletConnect option to be hidden in the wallet picker.
 */
export function getWalletConnectProjectId(): string | null {
  const raw = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '').trim();
  return raw.length > 0 ? raw : null;
}

/**
 * Samples two recent block timestamps on Igra Mainnet to derive the
 * current wall-clock seconds-per-block. Used purely for UX countdown
 * copy ("window resets in ~2h 15m"); throttle enforcement on chain is
 * always block-based and unaffected by this estimate.
 *
 * Clamped into [0.5, 10] so a momentary RPC glitch or reorg quirk can't
 * produce nonsensical display values. Falls back to 1.0 on error.
 */
export async function estimateIgraBlockTimeSeconds(
  publicClient: PublicClient
): Promise<number> {
  const FALLBACK = 1.0;
  const MIN = 0.5;
  const MAX = 10.0;
  const SAMPLE_SPAN = 1000n;

  try {
    const latest = await publicClient.getBlock({ blockTag: 'latest' });
    if (latest.number === null || latest.number < SAMPLE_SPAN) {
      return FALLBACK;
    }

    const earlierNumber = latest.number - SAMPLE_SPAN;
    const earlier = await publicClient.getBlock({ blockNumber: earlierNumber });

    const blockDelta = latest.number - earlier.number;
    if (blockDelta === 0n) return FALLBACK;

    const timeDelta = Number(latest.timestamp - earlier.timestamp);
    if (!Number.isFinite(timeDelta) || timeDelta <= 0) return FALLBACK;

    const seconds = timeDelta / Number(blockDelta);
    if (!Number.isFinite(seconds)) return FALLBACK;

    return Math.max(MIN, Math.min(MAX, seconds));
  } catch (error) {
    console.warn('Failed to sample Igra block time; falling back to 1s/block', error);
    return FALLBACK;
  }
}
