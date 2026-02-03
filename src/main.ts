/**
 * Igra Bridge - Main Entry Point
 * 
 * A simple bridge interface for moving KAS from Kaspa Testnet-10
 * to iKAS on Igra Galleon Testnet.
 */

import { CONFIG, sompiToKas, isValidL2Address } from './config';
import { isKastleInstalled, connectWallet, verifyNetwork, KastleAccount } from './kastle';
import { executeBridge, executeBridgeWithMining, isMiningAvailable, getExplorerUrl, getL2ExplorerUrl, BridgeResult } from './bridge';
import { initKaspaWasm } from './kaspa-wasm';

// UI State
let connectedAccount: KastleAccount | null = null;

// DOM Elements
const elements = {
  walletSection: () => document.getElementById('wallet-section')!,
  bridgeSection: () => document.getElementById('bridge-section')!,
  resultSection: () => document.getElementById('result-section')!,
  
  connectBtn: () => document.getElementById('connect-btn') as HTMLButtonElement,
  walletStatus: () => document.getElementById('wallet-status')!,
  walletAddress: () => document.getElementById('wallet-address')!,
  networkStatus: () => document.getElementById('network-status')!,
  
  amountInput: () => document.getElementById('amount-input') as HTMLInputElement,
  l2AddressInput: () => document.getElementById('l2-address-input') as HTMLInputElement,
  bridgeBtn: () => document.getElementById('bridge-btn') as HTMLButtonElement,
  
  logOutput: () => document.getElementById('log-output')!,
  resultTxId: () => document.getElementById('result-txid')!,
  resultAmount: () => document.getElementById('result-amount')!,
  resultL2Address: () => document.getElementById('result-l2-address')!,
  explorerLink: () => document.getElementById('explorer-link') as HTMLAnchorElement,
  l2ExplorerLink: () => document.getElementById('l2-explorer-link') as HTMLAnchorElement,
  
  errorMessage: () => document.getElementById('error-message')!,
};

/**
 * Log a message to the UI
 */
function log(message: string): void {
  const logOutput = elements.logOutput();
  const timestamp = new Date().toLocaleTimeString();
  logOutput.innerHTML += `<div>[${timestamp}] ${message}</div>`;
  logOutput.scrollTop = logOutput.scrollHeight;
}

/**
 * Show an error message
 */
function showError(message: string): void {
  const errorEl = elements.errorMessage();
  errorEl.textContent = message;
  errorEl.style.display = 'block';
  setTimeout(() => {
    errorEl.style.display = 'none';
  }, 10000);
}

/**
 * Clear error message
 */
function clearError(): void {
  elements.errorMessage().style.display = 'none';
}

/**
 * Update UI based on connection state
 */
function updateUI(): void {
  const walletStatus = elements.walletStatus();
  const walletAddress = elements.walletAddress();
  const connectBtn = elements.connectBtn();
  const bridgeSection = elements.bridgeSection();
  
  if (connectedAccount) {
    walletStatus.textContent = 'Connected';
    walletStatus.className = 'status-value connected';
    walletAddress.textContent = connectedAccount.address;
    connectBtn.textContent = 'Connected';
    connectBtn.disabled = true;
    bridgeSection.style.display = 'block';
  } else {
    walletStatus.textContent = 'Not connected';
    walletStatus.className = 'status-value';
    walletAddress.textContent = '-';
    connectBtn.textContent = 'Connect Kastle Wallet';
    connectBtn.disabled = false;
    bridgeSection.style.display = 'none';
  }
}

/**
 * Handle wallet connection
 */
async function handleConnect(): Promise<void> {
  clearError();
  
  if (!isKastleInstalled()) {
    showError('Kastle wallet not detected. Please install the Kastle extension from the Chrome Web Store.');
    window.open('https://chromewebstore.google.com/detail/kastle/oambclflhjfppdmkghokjmpppmaebego', '_blank');
    return;
  }
  
  try {
    elements.connectBtn().disabled = true;
    elements.connectBtn().textContent = 'Connecting...';
    
    const account = await connectWallet();
    connectedAccount = account;
    log(`Wallet connected: ${account.address}`);
    
    // Verify network
    const correctNetwork = await verifyNetwork();
    const networkStatus = elements.networkStatus();
    
    if (correctNetwork) {
      networkStatus.textContent = `${CONFIG.L1.NETWORK_ID} ✓`;
      networkStatus.className = 'status-value connected';
      log(`Network verified: ${CONFIG.L1.NETWORK_ID}`);
    } else {
      networkStatus.textContent = `Wrong network!`;
      networkStatus.className = 'status-value error';
      showError(`Please switch Kastle wallet to ${CONFIG.L1.NETWORK_ID}`);
      log(`WARNING: Wrong network. Please switch to ${CONFIG.L1.NETWORK_ID}`);
    }
    
    updateUI();
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to connect wallet';
    showError(msg);
    log(`Connection error: ${msg}`);
    elements.connectBtn().disabled = false;
    elements.connectBtn().textContent = 'Connect Kastle Wallet';
  }
}

/**
 * Handle bridge execution
 */
async function handleBridge(): Promise<void> {
  clearError();
  
  if (!connectedAccount) {
    showError('Please connect your wallet first');
    return;
  }
  
  const amountStr = elements.amountInput().value;
  const l2Address = elements.l2AddressInput().value.trim();
  
  // Validate inputs
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount < CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS) {
    showError(`Minimum amount is ${CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS} KAS`);
    return;
  }
  
  if (!isValidL2Address(l2Address)) {
    showError('Invalid L2 address. Must be a valid Ethereum address (0x...)');
    return;
  }
  
  try {
    elements.bridgeBtn().disabled = true;
    elements.logOutput().innerHTML = '';
    elements.resultSection().style.display = 'none';
    
    let result: BridgeResult;
    
    if (isMiningAvailable()) {
      // Use TX ID mining for guaranteed prefix match
      elements.bridgeBtn().textContent = 'Mining TX ID...';
      log('Starting bridge with TX ID mining...');
      log('This ensures the transaction will be recognized by Igra.');
      
      result = await executeBridgeWithMining(
        { amountKas: amount, l2Address },
        connectedAccount.address,
        (msg) => log(msg)
      );
    } else {
      // Fallback to simple send (may not match prefix)
      elements.bridgeBtn().textContent = 'Processing...';
      log('Starting bridge transaction (no mining - WASM not available)...');
      log('⚠️ TX ID prefix may not match - transaction might not be processed by Igra.');
      
      result = await executeBridge(
        { amountKas: amount, l2Address },
        (msg) => log(msg)
      );
    }
    
    showResult(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Bridge transaction failed';
    showError(msg);
    log(`ERROR: ${msg}`);
  } finally {
    elements.bridgeBtn().disabled = false;
    elements.bridgeBtn().textContent = 'Bridge TKAS → iKAS';
  }
}

/**
 * Display bridge result
 */
function showResult(result: BridgeResult): void {
  elements.resultSection().style.display = 'block';
  elements.resultTxId().textContent = result.txId;
  elements.resultAmount().textContent = `${sompiToKas(result.amountSompi)} KAS`;
  elements.resultL2Address().textContent = result.l2Address;
  
  const explorerLink = elements.explorerLink();
  explorerLink.href = getExplorerUrl(result.txId);
  
  const l2ExplorerLink = elements.l2ExplorerLink();
  l2ExplorerLink.href = getL2ExplorerUrl(result.l2Address);
  
  // Check TX ID prefix match
  const expectedPrefix = CONFIG.L1.TX_ID_PREFIX.toLowerCase();
  const actualPrefix = result.txId.slice(0, expectedPrefix.length).toLowerCase();
  const prefixMatches = actualPrefix === expectedPrefix;
  
  if (prefixMatches) {
    log('✅ Bridge transaction submitted successfully!');
    log(`✅ TX ID prefix matches (${expectedPrefix}) - Igra will process this transaction.`);
  } else {
    log('⚠️ Transaction submitted but TX ID prefix does not match.');
    log(`   Expected: ${expectedPrefix}, Got: ${actualPrefix}`);
    log('⚠️ This transaction will NOT be recognized by Igra.');
    log('   Your KAS was sent to the entry address but iKAS will not be minted.');
    log('   You may need to contact Igra support for recovery.');
  }
  
  log(`View on Kaspa Explorer: ${getExplorerUrl(result.txId)}`);
}

/**
 * Initialize the Kaspa WASM module
 */
async function initWasm(): Promise<boolean> {
  try {
    log('Initializing Kaspa WASM...');
    await initKaspaWasm();
    log('✓ Kaspa WASM initialized - TX ID mining enabled');
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log(`⚠️ WASM init failed: ${msg}`);
    log('⚠️ TX ID mining disabled - transactions may not be recognized by Igra.');
    return false;
  }
}

/**
 * Initialize the application
 */
async function init(): Promise<void> {
  // Display config info first
  log(`Igra Bridge v1.0`);
  log(`─────────────────────────────`);
  log(`L1: Kaspa ${CONFIG.L1.NETWORK_ID}`);
  log(`L2: ${CONFIG.L2.NETWORK_NAME} (Chain ID: ${CONFIG.L2.CHAIN_ID})`);
  log(`Entry Address: ${CONFIG.L1.ENTRY_ADDRESS.slice(0, 30)}...`);
  log(`Required TX Prefix: ${CONFIG.L1.TX_ID_PREFIX}`);
  log(`─────────────────────────────`);
  
  // Initialize WASM
  await initWasm();
  
  // Check if Kastle is installed
  if (!isKastleInstalled()) {
    log('⚠️ Kastle wallet not detected. Please install the extension.');
  } else {
    log('✓ Kastle wallet detected. Click "Connect" to begin.');
  }
  
  // Set up event listeners
  elements.connectBtn().addEventListener('click', handleConnect);
  elements.bridgeBtn().addEventListener('click', handleBridge);
  
  // Set minimum amount
  elements.amountInput().min = CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS.toString();
  elements.amountInput().placeholder = `Min: ${CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS} KAS`;
  
  updateUI();
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
