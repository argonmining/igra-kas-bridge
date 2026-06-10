/**
 * TX ID Miner - Mines nonces to achieve required TX ID prefix
 *
 * Uses Kaspa WASM SDK to:
 * 1. Connect to Kaspa network via Resolver
 * 2. Fetch UTXOs for user's address
 * 3. Build transaction with Entry payload
 * 4. Mine nonce until TX ID matches required prefix
 * 5. Return unsigned transaction for Kastle to sign
 *
 * API verified against kaspa.d.ts type definitions.
 */

import { CONFIG, getMainnetFee, getEntrySubnetworkId, isLaneNetwork } from './config';
import { getKaspaWasm, isWasmInitialized } from './kaspa-wasm';
import { constructEntryPayload, payloadToHex } from './bridge';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Mining state
let rpcClient: any = null;
let isConnected = false;
let connectedNetworkId: string | null = null;

/**
 * Initialize RPC connection using Resolver
 *
 * Reconnects if the network has changed since last connection.
 */
export async function initRpcConnection(): Promise<void> {
  if (!isWasmInitialized()) {
    throw new Error('Kaspa WASM not initialized');
  }

  const targetNetwork = CONFIG.L1.NETWORK_ID;

  // Reconnect if network changed
  if (isConnected && rpcClient && connectedNetworkId !== targetNetwork) {
    console.log(`Network changed from ${connectedNetworkId} to ${targetNetwork}, reconnecting...`);
    await disconnectRpc();
  }

  if (isConnected && rpcClient) {
    return;
  }

  const kaspa = getKaspaWasm();

  try {
    const testnetNodeUrl = targetNetwork === 'testnet-10'
      ? import.meta.env.VITE_TESTNET_NODE_URL
      : undefined;

    if (testnetNodeUrl) {
      console.log(`Creating RpcClient for ${targetNetwork} via direct URL: ${testnetNodeUrl}...`);
      rpcClient = new kaspa.RpcClient({
        url: testnetNodeUrl,
        networkId: targetNetwork,
      });
    } else {
      console.log('Creating Resolver...');
      const resolver = new kaspa.Resolver();

      console.log(`Creating RpcClient for ${targetNetwork}...`);
      rpcClient = new kaspa.RpcClient({
        resolver,
        networkId: targetNetwork,
      });
    }

    console.log('Connecting to RPC...');
    await rpcClient.connect();
    isConnected = true;
    connectedNetworkId = targetNetwork;

    console.log(`Connected to Kaspa network (${targetNetwork})${testnetNodeUrl ? ` via ${testnetNodeUrl}` : ' via resolver'}`);
  } catch (error) {
    console.error('RPC connection failed:', error);
    throw new Error(`RPC connection failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get UTXOs for an address
 */
export async function getUtxos(address: string): Promise<any[]> {
  if (!rpcClient || !isConnected) {
    throw new Error('RPC not connected');
  }

  const response = await rpcClient.getUtxosByAddresses([address]);
  return response.entries || [];
}

/**
 * Build an unsigned transaction with Entry payload
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

  const entryScriptPubKey = kaspa.payToAddressScript(entryAddress);
  const senderScriptPubKey = kaspa.payToAddressScript(senderAddress);

  // Bridge fee (mainnet only, from env variables)
  const bridgeFee = getMainnetFee();
  const bridgeFeeSompi = bridgeFee ? bridgeFee.amountSompi : 0n;

  // Lane (Igra) entry transactions run on a non-native subnetwork and must use
  // Toccata transaction version 1 (compute-budget inputs). Native entry
  // transactions stay on version 0 (sig-op-count inputs).
  const onLane = isLaneNetwork();

  // Network fee estimation (sompi). Kaspa charges per gram of transaction mass.
  // - Native (v0): ~1 sompi/gram. A generous flat minimum covers typical
  //   entry transactions (base mass ~700 + ~140/input + payload mass).
  // - Lane (v1, post-Toccata): the minimum standard fee rate rose to
  //   100 sompi * max(compute grams, 2 * tx bytes). With one compute-budget
  //   unit per input this is dominated by the compute term; the values below
  //   keep a comfortable margin above that floor.
  const baseFee = onLane ? 300_000n : 3000n;
  const perInputFee = onLane ? 100_000n : 1000n;

  let totalAvailable = 0n;
  const selectedUtxos: any[] = [];

  for (const utxo of utxos) {
    totalAvailable += utxo.amount;
    selectedUtxos.push(utxo);

    const estimatedNetworkFee = baseFee + perInputFee * BigInt(selectedUtxos.length);
    if (totalAvailable >= amountSompi + bridgeFeeSompi + estimatedNetworkFee) {
      break;
    }
  }

  const estimatedNetworkFee = baseFee + perInputFee * BigInt(selectedUtxos.length);

  if (totalAvailable < amountSompi + bridgeFeeSompi + estimatedNetworkFee) {
    const totalNeeded = amountSompi + bridgeFeeSompi + estimatedNetworkFee;
    throw new Error(`Insufficient funds. Have: ${totalAvailable}, Need: ${totalNeeded} (${amountSompi} amount + ${bridgeFeeSompi} bridge fee + ~${estimatedNetworkFee} network fee)`);
  }

  const inputs: any[] = selectedUtxos.map(utxo => ({
    previousOutpoint: {
      transactionId: utxo.outpoint.transactionId,
      index: utxo.outpoint.index,
    },
    signatureScript: '',
    sequence: 0n,
    // The two mass fields are mutually exclusive per transaction version and
    // the node rejects an input that sets the wrong one:
    //   - v0 (native): sig_op_count = 1, compute_budget must be 0.
    //   - v1 (lane):   compute_budget = 10 (single-sig: mass-per-sig-op 1000 /
    //                  grams-per-compute-budget-unit), sig_op_count MUST be 0.
    sigOpCount: onLane ? 0 : 1,
    ...(onLane ? { computeBudget: 10 } : {}),
    utxo: utxo,
  }));

  const change = totalAvailable - amountSompi - bridgeFeeSompi - estimatedNetworkFee;

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

  // Output 1: Bridge fee (mainnet only)
  if (bridgeFee && bridgeFeeSompi > 0n) {
    const feeScriptPubKey = kaspa.payToAddressScript(bridgeFee.address);
    outputs.push({
      value: bridgeFeeSompi,
      scriptPublicKey: {
        version: feeScriptPubKey.version,
        script: feeScriptPubKey.script,
      },
    });
  }

  // Change output: back to sender (if any)
  if (change > 0n) {
    outputs.push({
      value: change,
      scriptPublicKey: {
        version: senderScriptPubKey.version,
        script: senderScriptPubKey.script,
      },
    });
  }

  const txData = {
    version: onLane ? 1 : 0,
    inputs,
    outputs,
    lockTime: 0n,
    subnetworkId: getEntrySubnetworkId(),
    gas: 0n,
    payload: payloadHex,
  };

  const tx = new kaspa.Transaction(txData);

  return tx;
}

/**
 * Get transaction ID from a transaction object
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
 *
 * @param senderAddress Kaspa address of the sender
 * @param l2Address L2 destination address
 * @param amountSompi Amount in SOMPI
 * @param entryAddress Kaspa address to send to (entry address or sender for self-send)
 * @param onProgress Optional progress callback
 */
export async function mineTxId(
  senderAddress: string,
  l2Address: string,
  amountSompi: bigint,
  entryAddress: string,
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
      entryAddress,
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
 * Serialize transaction to JSON for wallet signing
 */
export function serializeTransaction(tx: any): string {
  return tx.serializeToSafeJSON();
}

/**
 * Submit signed transaction to network
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
    connectedNetworkId = null;
    rpcClient = null;
  }
}

/**
 * Check if RPC is connected
 */
export function isRpcConnected(): boolean {
  return isConnected;
}
