/**
 * Kaspa WASM SDK Integration
 * 
 * Loads and initializes the Kaspa WASM module for transaction construction
 * and TX ID mining.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import init, * as kaspa from './kaspa/kaspa.js';

let wasmInitialized = false;

/**
 * Initialize the Kaspa WASM module
 */
export async function initKaspaWasm(): Promise<typeof kaspa> {
  if (wasmInitialized) {
    return kaspa;
  }
  
  try {
    // Initialize WASM - uses import.meta.url internally to find the .wasm file
    await init();
    
    // Enable console panic hooks for debugging
    if (typeof (kaspa as any).initConsolePanicHook === 'function') {
      (kaspa as any).initConsolePanicHook();
    }
    
    wasmInitialized = true;
    
    console.log('Kaspa WASM initialized successfully');
    return kaspa;
  } catch (error) {
    console.error('Failed to initialize Kaspa WASM:', error);
    throw new Error(`Failed to initialize Kaspa WASM: ${error}`);
  }
}

/**
 * Check if WASM is initialized
 */
export function isWasmInitialized(): boolean {
  return wasmInitialized;
}

/**
 * Get the initialized WASM module
 */
export function getKaspaWasm(): typeof kaspa {
  if (!wasmInitialized) {
    throw new Error('Kaspa WASM not initialized. Call initKaspaWasm() first.');
  }
  return kaspa;
}
