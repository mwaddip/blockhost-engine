/**
 * Contract withdrawal logic
 *
 * Step 1 of the fund cycle: withdraw accumulated tokens from the
 * subscription contract to the hot wallet.
 */

import { ethers } from "ethers";
import type { Addressbook, FundManagerConfig } from "./types";
import { resolveWallet } from "./addressbook";
import {
  SUBSCRIPTION_ABI,
  ERC20_ABI,
  getTokenBalance,
} from "./token-utils";

/**
 * Withdraw all eligible token balances from the contract to the hot wallet.
 * Only withdraws tokens whose USD value exceeds the configured threshold.
 */
export async function withdrawFromContract(
  contractAddress: string,
  book: Addressbook,
  config: FundManagerConfig,
  provider: ethers.Provider
): Promise<void> {
  // Server wallet is the contract owner and can call withdrawFunds
  const serverWallet = resolveWallet("server", book, provider);
  if (!serverWallet) {
    console.error("[FUND] Cannot withdraw: server wallet not available");
    return;
  }

  const hotAddress = book.hot?.address;
  if (!hotAddress) {
    console.error("[FUND] Cannot withdraw: hot wallet not configured");
    return;
  }

  const contract = new ethers.Contract(contractAddress, SUBSCRIPTION_ABI, serverWallet);

  // Get all payment method IDs
  let paymentMethodIds: bigint[];
  try {
    paymentMethodIds = await contract.getPaymentMethodIds();
  } catch (err) {
    console.error(`[FUND] Error getting payment method IDs: ${err}`);
    return;
  }

  if (paymentMethodIds.length === 0) {
    console.log("[FUND] No payment methods configured, skipping withdrawal");
    return;
  }

  // Collect unique token addresses
  const tokens = new Map<string, { address: string; pmId: bigint }>();
  for (const pmId of paymentMethodIds) {
    try {
      const [tokenAddress, , , , , active] = await contract.getPaymentMethod(pmId);
      if (!active) continue;
      const addrLower = tokenAddress.toLowerCase();
      if (!tokens.has(addrLower)) {
        tokens.set(addrLower, { address: tokenAddress, pmId });
      }
    } catch (err) {
      console.error(`[FUND] Error querying payment method ${pmId}: ${err}`);
    }
  }

  // For each unique token, check contract balance and withdraw if above threshold
  for (const [, { address: tokenAddress, pmId }] of tokens) {
    try {
      const { balance, decimals, symbol } = await getTokenBalance(
        tokenAddress,
        contractAddress,
        provider
      );

      if (balance === 0n) continue;

      // Check USD value
      let usdValue: number;
      try {
        const priceUsdCents: bigint = await contract.getTokenPriceUsdCents(pmId);
        const balanceFloat = parseFloat(ethers.formatUnits(balance, decimals));
        usdValue = (balanceFloat * Number(priceUsdCents)) / 100;
      } catch {
        // Assume stablecoin 1:1
        usdValue = parseFloat(ethers.formatUnits(balance, decimals));
      }

      if (usdValue < config.min_withdrawal_usd) {
        console.log(
          `[FUND] Skipping ${symbol}: $${usdValue.toFixed(2)} below $${config.min_withdrawal_usd} threshold`
        );
        continue;
      }

      console.log(
        `[FUND] Withdrawing ${ethers.formatUnits(balance, decimals)} ${symbol} (~$${usdValue.toFixed(2)}) to hot wallet`
      );

      const tx = await contract.withdrawFunds(tokenAddress, hotAddress);
      await tx.wait();
      console.log(`[FUND] Withdrawal complete: tx ${tx.hash}`);
    } catch (err) {
      console.error(`[FUND] Error withdrawing ${tokenAddress}: ${err}`);
    }
  }
}
