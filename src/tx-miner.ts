/**
 * TX ID Miner - Mines nonces to achieve required TX ID prefix
 * 
 * Uses Kaspa WASM SDK to:
 * 1. Connect to Kaspa network via Resolver
 * 2. Fetch UTXOs for user's address
 * 3. Build transaction with Entry payload
 * 4. Mine nonce until TX ID matches required prefix (97b4)
 * 5. Return unsigned transaction for Kastle to sign
 * 
 * API verified against kaspa.d.ts type definitions.
 */

import { CONFIG } from './config';
import { getKaspaWasm, isWasmInitialized } from './kaspa-wasm';
import { constructEntryPayload, payloadToHex } from './bridge';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Mining state
let rpcClient: any = null;
let isConnected = false;

/**
 * Initialize RPC connection using Resolver
 * 
 * Verified: RpcClient constructor takes { resolver: Resolver, networkId: string }
 * Verified: Resolver constructor takes optional config or nothing
 * Verified: RpcClient.connect() returns Promise<void>
 */
export async function initRpcConnection(): Promise<void> {
  if (!isWasmInitialized()) {
    throw new Error('Kaspa WASM not initialized');
  }
  
  if (isConnected && rpcClient) {
    return;
  }
  
  const kaspa = getKaspaWasm();
  
  try {
    console.log('Creating Resolver...');
    const resolver = new kaspa.Resolver();
    
    console.log('Creating RpcClient...');
    rpcClient = new kaspa.RpcClient({
      resolver,
      networkId: CONFIG.L1.NETWORK_ID,
    });
    
    console.log('Connecting to RPC...');
    await rpcClient.connect();
    isConnected = true;
    
    console.log('Connected to Kaspa network via resolver');
  } catch (error) {
    console.error('RPC connection failed:', error);
    throw new Error(`RPC connection failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get UTXOs for an address
 * 
 * Verified: getUtxosByAddresses(string[]) returns { entries: UtxoEntryReference[] }
 * Verified: UtxoEntryReference has: outpoint, amount, scriptPublicKey
 */
export async function getUtxos(address: string): Promise<any[]> {
  if (!rpcClient || !isConnected) {
    throw new Error('RPC not connected');
  }
  
  // Verified: accepts Address[] | string[]
  const response = await rpcClient.getUtxosByAddresses([address]);
  return response.entries || [];
}

/**
 * Build an unsigned transaction with Entry payload
 * 
 * Verified interfaces:
 * - ITransaction { version, inputs, outputs, lockTime, subnetworkId, gas, payload }
 * - ITransactionInput { previousOutpoint: { transactionId, index }, signatureScript?, sequence, sigOpCount }
 * - ITransactionOutput { value, scriptPublicKey: IScriptPublicKey | HexString }
 * - IScriptPublicKey { version, script }
 * 
 * Verified: payToAddressScript(string) returns ScriptPublicKey
 * Verified: Transaction constructor takes ITransaction
 */
export function buildEntryTransaction(
  kaspa: any,
  utxos: any[],
  senderAddress: string,
  entryAddress: string,
  amountSompi: bigint,
  l2Address: string,
  nonce: number
): any {
  // Construct the Entry payload
  const payload = constructEntryPayload(l2Address, amountSompi, nonce);
  const payloadHex = payloadToHex(payload);
  
  // Verified: payToAddressScript returns ScriptPublicKey with { version, script }
  const entryScriptPubKey = kaspa.payToAddressScript(entryAddress);
  const senderScriptPubKey = kaspa.payToAddressScript(senderAddress);
  
  // Calculate total available from UTXOs
  // Verified: UtxoEntryReference has .amount (bigint) and .outpoint (TransactionOutpoint)
  let totalAvailable = 0n;
  const selectedUtxos: any[] = [];
  
  for (const utxo of utxos) {
    totalAvailable += utxo.amount;
    selectedUtxos.push(utxo);
    
    // Stop once we have enough (with buffer for fees)
    const feeBuffer = 10000n; // 0.0001 KAS for fees
    if (totalAvailable >= amountSompi + feeBuffer) {
      break;
    }
  }
  
  if (totalAvailable < amountSompi) {
    throw new Error(`Insufficient funds. Have: ${totalAvailable}, Need: ${amountSompi}`);
  }
  
  // Build inputs array
  // Verified: ITransactionInput interface
  // IMPORTANT: Include utxo data for signing - ISerializableTransactionInput requires it
  const inputs: any[] = selectedUtxos.map(utxo => ({
    previousOutpoint: {
      transactionId: utxo.outpoint.transactionId,
      index: utxo.outpoint.index,
    },
    signatureScript: '', // Empty for unsigned, will be filled by signing
    sequence: 0n,
    sigOpCount: 1,
    // Include UTXO reference for signing (needed by ISerializableTransactionInput)
    utxo: utxo,
  }));
  
  // Fee based on typical transaction mass - Kaspa requires ~1 sompi per gram
  // Entry transactions with payload are larger, using safe minimum
  const estimatedFee = 10000n; // 0.0001 KAS - covers most entry transactions
  const change = totalAvailable - amountSompi - estimatedFee;
  
  // Build outputs array
  // Verified: ITransactionOutput { value, scriptPublicKey }
  // Output 0: KAS Locking UTXO (Entry address with exact amount) - MUST be first per Igra spec
  const outputs: any[] = [
    {
      value: amountSompi,
      scriptPublicKey: {
        version: entryScriptPubKey.version,
        script: entryScriptPubKey.script,
      },
    },
  ];
  
  // Output 1: Change back to sender (if any)
  if (change > 0n) {
    outputs.push({
      value: change,
      scriptPublicKey: {
        version: senderScriptPubKey.version,
        script: senderScriptPubKey.script,
      },
    });
  }
  
  // Verified: Transaction constructor takes ITransaction
  const txData = {
    version: 0,
    inputs,
    outputs,
    lockTime: 0n,
    subnetworkId: '0000000000000000000000000000000000000000', // Native subnetwork (20 bytes = 40 hex chars)
    gas: 0n,
    payload: payloadHex,
  };
  
  const tx = new kaspa.Transaction(txData);
  
  return tx;
}

/**
 * Get transaction ID from a transaction object
 * 
 * Verified: Transaction.id is readonly string property
 */
export function getTransactionId(tx: any): string {
  return tx.id;
}

/**
 * Check if TX ID matches required prefix
 */
export function matchesPrefix(txId: string, prefix: string): boolean {
  return txId.toLowerCase().startsWith(prefix.toLowerCase());
}

/**
 * Mine nonce to find TX ID matching required prefix
 */
export async function mineTxId(
  senderAddress: string,
  l2Address: string,
  amountSompi: bigint,
  onProgress?: (iteration: number, currentTxId: string) => void
): Promise<{ tx: any; txId: string; nonce: number; iterations: number }> {
  if (!isWasmInitialized()) {
    throw new Error('Kaspa WASM not initialized');
  }
  
  const kaspa = getKaspaWasm();
  
  // Ensure RPC is connected
  await initRpcConnection();
  
  // Get UTXOs for sender
  const utxos = await getUtxos(senderAddress);
  if (utxos.length === 0) {
    throw new Error('No UTXOs found for sender address. Make sure your wallet has funds.');
  }
  
  const requiredPrefix = CONFIG.L1.TX_ID_PREFIX;
  const maxIterations = CONFIG.MINING.MAX_NONCE_ITERATIONS;
  
  // Start with random nonce to avoid collisions
  let nonce = Math.floor(Math.random() * 0xFFFFFFFF);
  
  for (let i = 0; i < maxIterations; i++) {
    // Build transaction with current nonce
    const tx = buildEntryTransaction(
      kaspa,
      utxos,
      senderAddress,
      CONFIG.L1.ENTRY_ADDRESS,
      amountSompi,
      l2Address,
      nonce
    );
    
    const txId = getTransactionId(tx);
    
    // Report progress periodically
    if (onProgress && i % CONFIG.MINING.PROGRESS_INTERVAL === 0) {
      onProgress(i, txId);
    }
    
    // Check if we found a match
    if (matchesPrefix(txId, requiredPrefix)) {
      return { tx, txId, nonce, iterations: i + 1 };
    }
    
    // Increment nonce (wrap around at max uint32)
    nonce = (nonce + 1) >>> 0;
  }
  
  throw new Error(`Failed to find matching TX ID after ${maxIterations} iterations`);
}

/**
 * Serialize transaction to JSON for Kastle signing
 * 
 * Verified: Transaction.serializeToSafeJSON() returns string with bigints as strings
 * Using SafeJSON because Kastle may expect string types for numeric fields
 */
export function serializeForKastle(tx: any): string {
  return tx.serializeToSafeJSON();
}

/**
 * Submit signed transaction to network
 * 
 * Verified: submitTransaction({ transaction: Transaction, allowOrphan?: boolean })
 * Returns: { transactionId: HexString }
 */
export async function submitTransaction(signedTx: any): Promise<string> {
  if (!rpcClient || !isConnected) {
    throw new Error('RPC not connected');
  }
  
  const response = await rpcClient.submitTransaction({
    transaction: signedTx,
    allowOrphan: false,
  });
  
  return response.transactionId;
}

/**
 * Disconnect RPC client
 */
export async function disconnectRpc(): Promise<void> {
  if (rpcClient && isConnected) {
    await rpcClient.disconnect();
    isConnected = false;
    rpcClient = null;
  }
}

/**
 * Check if RPC is connected
 */
export function isRpcConnected(): boolean {
  return isConnected;
}
