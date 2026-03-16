/**
 * Igra Bridge - Main Entry Point
 *
 * A bridge interface for moving KAS from Kaspa L1 to iKAS on Igra L2.
 * Supports Galleon Testnet (testnet-10) and Galleon Test Mainnet (mainnet).
 */

import { CONFIG, sompiToKas, isValidL2Address, getNetworkMode, setNetworkMode, getMainnetFee, type NetworkMode } from './config';
import { isKastleInstalled, connectWallet as kastleConnect, verifyNetworkByAddress, ensureNetwork as kastleEnsureNetwork, disconnectWallet as kastleDisconnect } from './kastle';
import { isKaswareInstalled, connectWallet as kaswareConnect, ensureNetwork as kaswareEnsureNetwork, disconnectWallet as kaswareDisconnect } from './kasware';
import { executeBridge, executeBridgeWithMining, isMiningAvailable, getExplorerUrl, getL2ExplorerUrl, BridgeResult } from './bridge';
import { initKaspaWasm } from './kaspa-wasm';
import { disconnectRpc } from './tx-miner';
import type { WalletType, ConnectedWallet } from './wallet';

// UI State
let connectedWallet: ConnectedWallet | null = null;
let selectedWalletType: WalletType | null = null;

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

  // Network selector
  networkTestnetBtn: () => document.getElementById('network-testnet-btn') as HTMLButtonElement,
  networkTestMainnetBtn: () => document.getElementById('network-test-mainnet-btn') as HTMLButtonElement,
  networkMainnetBtn: () => document.getElementById('network-mainnet-btn') as HTMLButtonElement,
  infoBanner: () => document.getElementById('info-banner')!,
  pageSubtitle: () => document.getElementById('page-subtitle')!,

  // Wallet selector
  walletKastleBtn: () => document.getElementById('wallet-kastle-btn') as HTMLButtonElement,
  walletKaswareBtn: () => document.getElementById('wallet-kasware-btn') as HTMLButtonElement,
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
 * Get display labels based on current network mode
 */
function getLabels() {
  const mode = getNetworkMode();
  if (mode === 'mainnet') {
    const fee = getMainnetFee();
    const feeNote = fee ? ` Bridge fee: ${sompiToKas(fee.amountSompi)} KAS per transaction.` : '';
    return {
      kasSymbol: 'KAS',
      bridgeAction: 'Bridge KAS → iKAS',
      subtitle: 'Kaspa Mainnet → Igra Mainnet',
      bannerHtml: `<strong>Igra Mainnet</strong> — Wraps KAS into iKAS on Igra Mainnet. Min: ${CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS} KAS · Max: ${CONFIG.L1.MAX_BRIDGE_AMOUNT_KAS} KAS.${feeNote}`,
    };
  }
  if (mode === 'test-mainnet') {
    return {
      kasSymbol: 'KAS',
      bridgeAction: 'Bridge KAS → iKAS',
      subtitle: 'Kaspa Mainnet → Igra Galleon Test Mainnet',
      bannerHtml: `<strong>Test Mainnet</strong> — Wraps KAS into iKAS on Galleon Test Mainnet via self-send. Min: ${CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS} KAS.`,
    };
  }
  return {
    kasSymbol: 'TKAS',
    bridgeAction: 'Bridge TKAS → iKAS',
    subtitle: 'Kaspa Testnet-10 → Igra Galleon',
    bannerHtml: `<strong>Galleon Testnet</strong> — Bridges tKAS into iKAS on Igra Galleon Testnet. Min: ${CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS} KAS.`,
  };
}

/**
 * Update UI text for the currently selected network
 */
function updateNetworkUI(): void {
  const mode = getNetworkMode();
  const labels = getLabels();

  // Toggle button active states
  const testnetBtn = elements.networkTestnetBtn();
  const testMainnetBtn = document.getElementById('network-test-mainnet-btn');
  const mainnetBtn = elements.networkMainnetBtn();
  testnetBtn.classList.toggle('active', mode === 'testnet');
  testMainnetBtn?.classList.toggle('active', mode === 'test-mainnet');
  mainnetBtn.classList.toggle('active', mode === 'mainnet');

  // Update dynamic text
  elements.pageSubtitle().textContent = labels.subtitle;
  elements.infoBanner().innerHTML = labels.bannerHtml;
  elements.bridgeBtn().textContent = labels.bridgeAction;
}

/**
 * Handle network mode switch
 */
async function handleNetworkSwitch(mode: NetworkMode): Promise<void> {
  if (mode === getNetworkMode()) return;

  // Disconnect wallet extension before switching
  if (connectedWallet) {
    if (connectedWallet.type === 'kastle') await kastleDisconnect();
    else await kaswareDisconnect();
  }

  setNetworkMode(mode);
  connectedWallet = null;
  await disconnectRpc();

  // Reset network status
  const networkStatus = elements.networkStatus();
  networkStatus.textContent = '-';
  networkStatus.className = 'status-value';

  updateNetworkUI();
  updateUI();

  // Clear log and show new config
  elements.logOutput().innerHTML = '';
  elements.resultSection().style.display = 'none';
  clearError();

  log(`Switched to ${CONFIG.L2.NETWORK_NAME}`);
  log(`L1: Kaspa ${CONFIG.L1.NETWORK_ID}`);
  log(`L2: ${CONFIG.L2.NETWORK_NAME} (Chain ID: ${CONFIG.L2.CHAIN_ID})`);
  if (CONFIG.L1.ENTRY_ADDRESS) {
    log(`Entry Address: ${CONFIG.L1.ENTRY_ADDRESS.slice(0, 30)}...`);
  } else {
    log(`Entry mode: self-send (KAS sent to your own address)`);
  }
  log(`Required TX Prefix: ${CONFIG.L1.TX_ID_PREFIX}`);

  // Update amount constraints for the new network
  const amountInput = elements.amountInput();
  amountInput.min = CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS.toString();
  if (CONFIG.L1.MAX_BRIDGE_AMOUNT_KAS !== null) {
    amountInput.max = CONFIG.L1.MAX_BRIDGE_AMOUNT_KAS.toString();
    amountInput.placeholder = `${CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS} – ${CONFIG.L1.MAX_BRIDGE_AMOUNT_KAS} KAS`;
  } else {
    amountInput.removeAttribute('max');
    amountInput.placeholder = `Min: ${CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS} KAS`;
  }

  logWalletDetection();
}

/**
 * Log which wallets are detected
 */
function logWalletDetection(): void {
  const kastleOk = isKastleInstalled();
  const kaswareOk = isKaswareInstalled();

  if (kastleOk && kaswareOk) {
    log('Kastle and Kasware wallets detected. Select a wallet and click "Connect".');
  } else if (kastleOk) {
    log('Kastle wallet detected. Kasware not found.');
  } else if (kaswareOk) {
    log('Kasware wallet detected. Kastle not found.');
  } else {
    log('No Kaspa wallet detected. Please install Kastle or Kasware.');
  }
}

/**
 * Handle wallet type selection
 */
function selectWallet(type: WalletType): void {
  selectedWalletType = type;

  const kastleBtn = elements.walletKastleBtn();
  const kaswareBtn = elements.walletKaswareBtn();
  kastleBtn.classList.toggle('active', type === 'kastle');
  kaswareBtn.classList.toggle('active', type === 'kasware');

  updateUI();
}

/**
 * Update UI based on connection state
 */
function updateUI(): void {
  const walletStatus = elements.walletStatus();
  const walletAddress = elements.walletAddress();
  const connectBtn = elements.connectBtn();
  const bridgeSection = elements.bridgeSection();
  const kastleBtn = elements.walletKastleBtn();
  const kaswareBtn = elements.walletKaswareBtn();
  const walletSelector = kastleBtn.parentElement!;

  if (connectedWallet) {
    const walletName = connectedWallet.type === 'kastle' ? 'Kastle' : 'Kasware';
    walletStatus.textContent = `Connected (${walletName})`;
    walletStatus.className = 'status-value connected';
    walletAddress.textContent = connectedWallet.address;
    connectBtn.textContent = 'Disconnect';
    connectBtn.disabled = false;
    bridgeSection.style.display = 'block';

    kastleBtn.disabled = true;
    kaswareBtn.disabled = true;
    walletSelector.setAttribute('data-tooltip', 'Disconnect your wallet before switching');
  } else {
    walletStatus.textContent = 'Not connected';
    walletStatus.className = 'status-value';
    walletAddress.textContent = '-';

    kastleBtn.disabled = !isKastleInstalled();
    kaswareBtn.disabled = !isKaswareInstalled();
    walletSelector.removeAttribute('data-tooltip');

    if (selectedWalletType) {
      const walletName = selectedWalletType === 'kastle' ? 'Kastle' : 'Kasware';
      connectBtn.textContent = `Connect ${walletName}`;
      connectBtn.disabled = false;
    } else {
      connectBtn.textContent = 'Select a Wallet';
      connectBtn.disabled = true;
    }

    bridgeSection.style.display = 'none';
  }
}

/**
 * Handle wallet connection
 */
async function handleConnect(): Promise<void> {
  clearError();

  if (!selectedWalletType) {
    showError('Please select a wallet first.');
    return;
  }

  const walletName = selectedWalletType === 'kastle' ? 'Kastle' : 'Kasware';

  const isInstalled = selectedWalletType === 'kastle' ? isKastleInstalled() : isKaswareInstalled();
  if (!isInstalled) {
    const installUrl = selectedWalletType === 'kastle'
      ? 'https://chromewebstore.google.com/detail/kastle/oambclflhjfppdmkghokjmpppmaebego'
      : 'https://chromewebstore.google.com/detail/kasware-wallet/hklhheigdglejcbllnodkdemomannpcg';
    showError(`${walletName} wallet not detected. Please install the extension.`);
    window.open(installUrl, '_blank');
    return;
  }

  try {
    elements.connectBtn().disabled = true;
    elements.connectBtn().textContent = 'Connecting...';

    // Attempt to switch wallet to correct network (best-effort, may no-op)
    if (selectedWalletType === 'kastle') {
      await kastleEnsureNetwork();
    } else {
      await kaswareEnsureNetwork();
    }

    let address: string;
    if (selectedWalletType === 'kastle') {
      const account = await kastleConnect();
      address = account.address;
    } else {
      address = await kaswareConnect();
    }

    // Verify network by address prefix (deterministic, bulletproof)
    const correctNetwork = verifyNetworkByAddress(address);
    const networkStatus = elements.networkStatus();

    if (correctNetwork) {
      connectedWallet = { address, type: selectedWalletType };
      log(`${walletName} wallet connected: ${address}`);
      networkStatus.textContent = `${CONFIG.L1.NETWORK_ID}`;
      networkStatus.className = 'status-value connected';
      log(`Network verified: ${CONFIG.L1.NETWORK_ID}`);
    } else {
      // Wrong network — disconnect and tell user to switch manually
      if (selectedWalletType === 'kastle') await kastleDisconnect();
      else await kaswareDisconnect();

      networkStatus.textContent = `Wrong network!`;
      networkStatus.className = 'status-value error';
      const got = address.startsWith('kaspatest:') ? 'testnet' : 'mainnet';
      showError(`${walletName} is on ${got}. Please switch to ${CONFIG.L1.NETWORK_ID} and reconnect.`);
      log(`WARNING: ${walletName} address is ${got}, expected ${CONFIG.L1.NETWORK_ID}`);
    }

    updateUI();
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to connect wallet';
    showError(msg);
    log(`Connection error: ${msg}`);
    updateUI();
  }
}

/**
 * Handle wallet disconnection
 */
async function handleDisconnect(): Promise<void> {
  if (!connectedWallet) return;

  const walletName = connectedWallet.type === 'kastle' ? 'Kastle' : 'Kasware';

  if (connectedWallet.type === 'kastle') await kastleDisconnect();
  else await kaswareDisconnect();

  connectedWallet = null;

  const networkStatus = elements.networkStatus();
  networkStatus.textContent = '-';
  networkStatus.className = 'status-value';

  log(`${walletName} wallet disconnected`);
  updateUI();
}

/**
 * Handle bridge execution
 */
async function handleBridge(): Promise<void> {
  clearError();

  if (!connectedWallet) {
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

  if (CONFIG.L1.MAX_BRIDGE_AMOUNT_KAS !== null && amount > CONFIG.L1.MAX_BRIDGE_AMOUNT_KAS) {
    showError(`Maximum amount is ${CONFIG.L1.MAX_BRIDGE_AMOUNT_KAS} KAS per transaction`);
    return;
  }

  if (!isValidL2Address(l2Address)) {
    showError('Invalid L2 address. Must be a valid Ethereum address (0x...)');
    return;
  }

  const labels = getLabels();

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
        connectedWallet.address,
        connectedWallet.type,
        (msg) => log(msg)
      );
    } else {
      // Fallback to simple send (may not match prefix)
      elements.bridgeBtn().textContent = 'Processing...';
      log('Starting bridge transaction (no mining - WASM not available)...');
      log('TX ID prefix may not match - transaction might not be processed by Igra.');

      result = await executeBridge(
        { amountKas: amount, l2Address },
        connectedWallet.address,
        connectedWallet.type,
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
    elements.bridgeBtn().textContent = labels.bridgeAction;
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
    log('Bridge transaction submitted successfully!');
    log(`TX ID prefix matches (${expectedPrefix}) - Igra will process this transaction.`);
  } else {
    log('Transaction submitted but TX ID prefix does not match.');
    log(`   Expected: ${expectedPrefix}, Got: ${actualPrefix}`);
    log('This transaction will NOT be recognized by Igra.');
    log('   Your KAS was sent but iKAS will not be minted.');
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
    log('Kaspa WASM initialized - TX ID mining enabled');
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log(`WASM init failed: ${msg}`);
    log('TX ID mining disabled - transactions may not be recognized by Igra.');
    return false;
  }
}

/**
 * Initialize the application
 */
async function init(): Promise<void> {
  // Display config info first
  log(`Igra Bridge v1.1`);
  log(`─────────────────────────────`);
  log(`L1: Kaspa ${CONFIG.L1.NETWORK_ID}`);
  log(`L2: ${CONFIG.L2.NETWORK_NAME} (Chain ID: ${CONFIG.L2.CHAIN_ID})`);
  if (CONFIG.L1.ENTRY_ADDRESS) {
    log(`Entry Address: ${CONFIG.L1.ENTRY_ADDRESS.slice(0, 30)}...`);
  } else {
    log(`Entry mode: self-send (KAS sent to your own address)`);
  }
  log(`Required TX Prefix: ${CONFIG.L1.TX_ID_PREFIX}`);
  log(`─────────────────────────────`);

  // Initialize WASM
  await initWasm();

  // Detect available wallets
  logWalletDetection();

  // Set up event listeners
  elements.connectBtn().addEventListener('click', () => {
    if (connectedWallet) handleDisconnect();
    else handleConnect();
  });
  elements.bridgeBtn().addEventListener('click', handleBridge);

  // Wallet selector listeners
  elements.walletKastleBtn().addEventListener('click', () => selectWallet('kastle'));
  elements.walletKaswareBtn().addEventListener('click', () => selectWallet('kasware'));

  // Network selector listeners
  elements.networkTestnetBtn().addEventListener('click', () => handleNetworkSwitch('testnet'));
  // elements.networkTestMainnetBtn().addEventListener('click', () => handleNetworkSwitch('test-mainnet'));
  elements.networkMainnetBtn().addEventListener('click', () => handleNetworkSwitch('mainnet'));

  // Set amount constraints
  elements.amountInput().min = CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS.toString();
  if (CONFIG.L1.MAX_BRIDGE_AMOUNT_KAS !== null) {
    elements.amountInput().max = CONFIG.L1.MAX_BRIDGE_AMOUNT_KAS.toString();
    elements.amountInput().placeholder = `${CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS} – ${CONFIG.L1.MAX_BRIDGE_AMOUNT_KAS} KAS`;
  } else {
    elements.amountInput().placeholder = `Min: ${CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS} KAS`;
  }

  // Initial UI state
  updateNetworkUI();
  updateUI();
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
