/**
 * Igra Bridge Configuration
 * 
 * Configuration for bridging KAS from Kaspa Testnet-10 (L1) to Igra Galleon Testnet (L2)
 */

export const CONFIG = {
  // L1 (Kaspa) Configuration
  L1: {
    NETWORK_ID: 'testnet-10' as const,
    
    // The P2SH address where KAS is locked for bridging
    // This is the Igra multisig entry address
    ENTRY_ADDRESS: 'kaspatest:qqmstl2znv9tsfgcmj9shme82my867tapz7pdu4ztwdn6sm9452jj5mm0sxzw',
    
    // Transaction ID must start with this prefix (hex)
    // This is used for tx ID mining/filtering
    TX_ID_PREFIX: '97b4',
    
    // Minimum bridge amount in KAS
    MIN_BRIDGE_AMOUNT_KAS: 1,
    
    // 1 KAS = 100,000,000 SOMPI (10^8)
    SOMPI_PER_KAS: 100_000_000n,
  },
  
  // L2 (Igra) Configuration  
  L2: {
    NETWORK_NAME: 'Igra Galleon Testnet',
    RPC_URL: 'https://galleon-testnet.igralabs.com:8545',
    CHAIN_ID: 38836,
    CURRENCY_SYMBOL: 'iKAS',
    CURRENCY_DECIMALS: 18,
    BLOCK_EXPLORER: 'https://explorer.galleon-testnet.igralabs.com',
  },
  
  // Entry Transaction Configuration
  ENTRY_TX: {
    // Version (4 bits) + TxTypeId (4 bits) = 0x92 for Entry transaction
    // Version: 0x9, TxTypeId: 0x2 (b0010)
    PAYLOAD_PREFIX: 0x92,
    
    // L2Data structure for Entry:
    // - 20 bytes: recipient L2 address
    // - 8 bytes: amount in SOMPI (unsigned int, big endian)
    L2_DATA_LENGTH: 28,
    
    // Nonce length for tx ID mining
    NONCE_LENGTH: 4,
  },
  
  // Mining Configuration
  MINING: {
    // Maximum nonce iterations before giving up
    MAX_NONCE_ITERATIONS: 10_000_000,
    
    // Report progress every N iterations
    PROGRESS_INTERVAL: 100_000,
  },
} as const;

/**
 * Validates an Ethereum-style address (0x prefixed, 40 hex chars)
 */
export function isValidL2Address(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validates a Kaspa testnet address
 */
export function isValidKaspaTestnetAddress(address: string): boolean {
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
