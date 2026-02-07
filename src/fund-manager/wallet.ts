/**
 * Keyfile loading and ethers.Wallet construction
 */

import * as fs from "fs";
import { ethers } from "ethers";
import { generateWallet as rootAgentGenerateWallet } from "../root-agent/client";

/**
 * Read a private key from a keyfile (hex, no 0x prefix)
 */
export function readKeyfile(keyfilePath: string): string {
  const raw = fs.readFileSync(keyfilePath, "utf8").trim();
  // Strip 0x prefix if present for consistency
  return raw.startsWith("0x") ? raw.slice(2) : raw;
}

/**
 * Create an ethers.Wallet from a keyfile path
 */
export function walletFromKeyfile(
  keyfilePath: string,
  provider: ethers.Provider
): ethers.Wallet {
  const privateKey = readKeyfile(keyfilePath);
  return new ethers.Wallet(privateKey, provider);
}

/**
 * Generate a new random wallet and save the key to a file (direct, requires write access)
 */
export function generateWallet(
  keyfilePath: string
): { address: string; wallet: ethers.HDNodeWallet } {
  const wallet = ethers.Wallet.createRandom();
  const privateKeyHex = wallet.privateKey.slice(2); // Remove 0x prefix
  fs.writeFileSync(keyfilePath, privateKeyHex, { mode: 0o600 });
  return { address: wallet.address, wallet };
}

/**
 * Generate a new wallet via root agent (for unprivileged callers)
 */
export async function generateWalletViaAgent(
  name: string
): Promise<{ address: string }> {
  return rootAgentGenerateWallet(name);
}
