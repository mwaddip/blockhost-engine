/**
 * Hot wallet distribution logic
 *
 * Steps 2-5 of the fund cycle:
 *  2. Top up hot wallet gas (server → hot ETH if hot is low)
 *  3. Top up server stablecoin buffer (hot → server stablecoin)
 *  4. Revenue shares (hot → dev/broker per revenue-share.json)
 *  5. Remainder to admin (hot → admin)
 */

import { ethers } from "ethers";
import type { Addressbook, FundManagerConfig, RevenueShareConfig } from "./types";
import { resolveWallet, resolveAddress } from "./addressbook";
import {
  SUBSCRIPTION_ABI,
  ERC20_ABI,
  getTokenBalance,
  transferToken,
  getAllTokenBalances,
} from "./token-utils";

/**
 * Step 2: Ensure hot wallet has enough ETH to pay for distribution transfers.
 * Server sends a small amount of ETH if hot wallet balance is below ~$1.
 */
export async function topUpHotWalletGas(
  book: Addressbook,
  provider: ethers.Provider
): Promise<void> {
  const hotAddress = book.hot?.address;
  if (!hotAddress) return;

  const hotBalance = await provider.getBalance(hotAddress);
  // If hot wallet has < 0.0005 ETH (~$1 at ~$2000/ETH), top it up
  const threshold = ethers.parseEther("0.0005");
  if (hotBalance >= threshold) return;

  const serverWallet = resolveWallet("server", book, provider);
  if (!serverWallet) {
    console.error("[FUND] Cannot top up hot wallet gas: server wallet not available");
    return;
  }

  const topUpAmount = ethers.parseEther("0.001");
  const serverBalance = await provider.getBalance(await serverWallet.getAddress());
  if (serverBalance < topUpAmount * 2n) {
    console.warn("[FUND] Server wallet ETH too low to top up hot wallet");
    return;
  }

  console.log(`[FUND] Topping up hot wallet gas: ${ethers.formatEther(topUpAmount)} ETH`);
  const tx = await serverWallet.sendTransaction({
    to: hotAddress,
    value: topUpAmount,
  });
  await tx.wait();
  console.log(`[FUND] Hot wallet gas top-up complete: tx ${tx.hash}`);
}

/**
 * Step 3: Ensure server wallet has enough stablecoin for future gas swaps.
 * Hot wallet sends stablecoin to server if server balance is below buffer.
 */
export async function topUpServerStablecoinBuffer(
  contractAddress: string,
  book: Addressbook,
  config: FundManagerConfig,
  provider: ethers.Provider
): Promise<void> {
  const serverAddress = book.server?.address;
  if (!serverAddress) return;

  const contract = new ethers.Contract(contractAddress, SUBSCRIPTION_ABI, provider);
  let stablecoinAddress: string;
  try {
    stablecoinAddress = await contract.getPrimaryStablecoin();
    if (stablecoinAddress === ethers.ZeroAddress) return;
  } catch {
    return;
  }

  const { balance: serverStableBalance, decimals } = await getTokenBalance(
    stablecoinAddress,
    serverAddress,
    provider
  );

  const bufferTarget = ethers.parseUnits(
    config.server_stablecoin_buffer_usd.toString(),
    decimals
  );

  if (serverStableBalance >= bufferTarget) return;

  // Hot wallet sends enough to bring server to buffer level
  const hotWallet = resolveWallet("hot", book, provider);
  if (!hotWallet) {
    console.error("[FUND] Cannot top up server buffer: hot wallet not available");
    return;
  }

  const needed = bufferTarget - serverStableBalance;
  const { balance: hotStableBalance } = await getTokenBalance(
    stablecoinAddress,
    book.hot!.address,
    provider
  );

  if (hotStableBalance < needed) {
    console.warn("[FUND] Hot wallet stablecoin insufficient for server buffer top-up");
    return;
  }

  console.log(
    `[FUND] Topping up server stablecoin buffer: ${ethers.formatUnits(needed, decimals)} to server`
  );
  await transferToken(stablecoinAddress, serverAddress, needed, hotWallet);
  console.log("[FUND] Server stablecoin buffer topped up");
}

/**
 * Step 4: Distribute revenue shares from hot wallet.
 */
export async function distributeRevenueShares(
  contractAddress: string,
  book: Addressbook,
  revenueConfig: RevenueShareConfig,
  provider: ethers.Provider
): Promise<void> {
  if (!revenueConfig.enabled || revenueConfig.recipients.length === 0) {
    return;
  }

  const hotWallet = resolveWallet("hot", book, provider);
  if (!hotWallet) {
    console.error("[FUND] Cannot distribute revenue shares: hot wallet not available");
    return;
  }

  const contract = new ethers.Contract(contractAddress, SUBSCRIPTION_ABI, provider);
  const balances = await getAllTokenBalances(book.hot!.address, contract, provider);

  for (const tb of balances) {
    if (tb.balance === 0n) continue;

    // Calculate total share amount
    const totalShareAmount =
      (tb.balance * BigInt(Math.round(revenueConfig.total_percent * 100))) / 10000n;

    if (totalShareAmount === 0n) continue;

    // Distribute to each recipient
    let distributed = 0n;
    for (let i = 0; i < revenueConfig.recipients.length; i++) {
      const recipient = revenueConfig.recipients[i];
      const recipientAddress = resolveAddress(recipient.role, book);
      if (!recipientAddress) {
        console.error(`[FUND] Revenue share recipient '${recipient.role}' not in addressbook`);
        continue;
      }

      const isLast = i === revenueConfig.recipients.length - 1;
      const share = isLast
        ? totalShareAmount - distributed
        : (totalShareAmount * BigInt(Math.round(recipient.percent * 100))) /
          BigInt(Math.round(revenueConfig.total_percent * 100));
      distributed += share;

      if (share === 0n) continue;

      try {
        await transferToken(tb.tokenAddress, recipientAddress, share, hotWallet);
        console.log(
          `[FUND] Revenue share: sent ${ethers.formatUnits(share, tb.decimals)} ${tb.symbol} to ${recipient.role} (${recipient.percent}%)`
        );
      } catch (err) {
        console.error(
          `[FUND] Error sending revenue share to ${recipient.role}: ${err}`
        );
      }
    }
  }
}

/**
 * Step 5: Send all remaining token balances from hot wallet to admin.
 */
export async function sendRemainderToAdmin(
  contractAddress: string,
  book: Addressbook,
  provider: ethers.Provider
): Promise<void> {
  const adminAddress = resolveAddress("admin", book);
  if (!adminAddress) {
    console.error("[FUND] Cannot send remainder: admin not in addressbook");
    return;
  }

  const hotWallet = resolveWallet("hot", book, provider);
  if (!hotWallet) {
    console.error("[FUND] Cannot send remainder: hot wallet not available");
    return;
  }

  const contract = new ethers.Contract(contractAddress, SUBSCRIPTION_ABI, provider);
  const balances = await getAllTokenBalances(book.hot!.address, contract, provider);

  for (const tb of balances) {
    if (tb.balance === 0n) continue;

    try {
      await transferToken(tb.tokenAddress, adminAddress, tb.balance, hotWallet);
      console.log(
        `[FUND] Remainder: sent ${ethers.formatUnits(tb.balance, tb.decimals)} ${tb.symbol} to admin`
      );
    } catch (err) {
      console.error(`[FUND] Error sending remainder to admin: ${err}`);
    }
  }
}
