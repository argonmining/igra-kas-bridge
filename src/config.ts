/**
 * Igra Bridge Configuration
 *
 * Configuration for bridging KAS from Kaspa L1 to iKAS on Igra L2.
 * Supports Galleon Testnet, Galleon Test Mainnet, and Igra Mainnet.
 */

export type NetworkMode = 'testnet' | 'test-mainnet' | 'mainnet';

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
      MAX_BRIDGE_AMOUNT_KAS: parseInt(import.meta.env.VITE_MAINNET_MAX_KAS, 10) || 300,
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
