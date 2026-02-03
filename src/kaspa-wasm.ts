/**
 * Kaspa WASM SDK Integration
 * 
 * Loads and initializes the Kaspa WASM module for transaction construction
 * and TX ID mining.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

let wasmInitialized = false;
let wasmModule: any = null;

// Dynamic import helper to bypass TypeScript module resolution
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<any>;

/**
 * Initialize the Kaspa WASM module
 */
export async function initKaspaWasm(): Promise<any> {
  if (wasmInitialized && wasmModule) {
    return wasmModule;
  }
  
  try {
    // Dynamic import of the Kaspa WASM module from public folder
    const kaspa = await dynamicImport('/kaspa/kaspa.js');
    
    // Initialize the WASM binary - default export is __wbg_init
    await kaspa.default('/kaspa/kaspa_bg.wasm');
    
    // Enable console panic hooks for debugging
    if (typeof kaspa.initConsolePanicHook === 'function') {
      kaspa.initConsolePanicHook();
    }
    
    wasmInitialized = true;
    wasmModule = kaspa;
    
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
export function getKaspaWasm(): any {
  if (!wasmModule) {
    throw new Error('Kaspa WASM not initialized. Call initKaspaWasm() first.');
  }
  return wasmModule;
}
