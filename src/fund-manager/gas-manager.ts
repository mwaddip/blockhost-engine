/**
 * Gas token monitoring and USDC→ETH swap
 *
 * Periodically checks the server wallet's ETH balance.
 * If below threshold, swaps stablecoin for ETH via Uniswap V2.
 */

import { ethers } from "ethers";
import type { Addressbook, FundManagerConfig } from "./types";
import { resolveWallet } from "./addressbook";
import { getChainConfig, UNISWAP_V2_ROUTER_ABI, UNISWAP_V2_PAIR_ABI } from "./chain-pools";
import { ERC20_ABI, getTokenBalance } from "./token-utils";

/**
 * Get ETH price in USD from a Uniswap V2 WETH/USDC pair
 */
async function getEthPriceUsd(
  pairAddress: string,
  wethAddress: string,
  usdcDecimals: number,
  provider: ethers.Provider
): Promise<number> {
  const pair = new ethers.Contract(pairAddress, UNISWAP_V2_PAIR_ABI, provider);

  const [reserve0, reserve1] = await pair.getReserves();
  const token0: string = await pair.token0();

  let wethReserve: bigint;
  let usdcReserve: bigint;

  if (token0.toLowerCase() === wethAddress.toLowerCase()) {
    wethReserve = reserve0;
    usdcReserve = reserve1;
  } else {
    wethReserve = reserve1;
    usdcReserve = reserve0;
  }

  // Price = usdcReserve / wethReserve, normalized for decimals
  const usdcFloat = parseFloat(ethers.formatUnits(usdcReserve, usdcDecimals));
  const wethFloat = parseFloat(ethers.formatEther(wethReserve));
  return usdcFloat / wethFloat;
}

/**
 * Check server wallet gas and swap USDC→ETH if needed.
 */
export async function checkAndSwapGas(
  book: Addressbook,
  config: FundManagerConfig,
  provider: ethers.Provider
): Promise<void> {
  const serverWallet = resolveWallet("server", book, provider);
  if (!serverWallet) {
    console.error("[GAS] Cannot check gas: server wallet not available");
    return;
  }

  const serverAddress = await serverWallet.getAddress();

  // Get network chain ID
  const network = await provider.getNetwork();
  const chainConfig = getChainConfig(network.chainId);
  if (!chainConfig) {
    console.error(`[GAS] No chain configuration for chainId ${network.chainId}`);
    return;
  }

  if (
    chainConfig.usdc_weth_pair === ethers.ZeroAddress ||
    chainConfig.usdc_weth_pair === "0x0000000000000000000000000000000000000000"
  ) {
    // No pair configured (e.g., testnet), skip gas management
    return;
  }

  // Check server ETH balance
  const ethBalance = await provider.getBalance(serverAddress);

  // Get ETH price to determine USD value
  const { decimals: usdcDecimals } = await getTokenBalance(
    chainConfig.usdc,
    serverAddress,
    provider
  );
  const ethPriceUsd = await getEthPriceUsd(
    chainConfig.usdc_weth_pair,
    chainConfig.weth,
    usdcDecimals,
    provider
  );

  const ethBalanceFloat = parseFloat(ethers.formatEther(ethBalance));
  const ethBalanceUsd = ethBalanceFloat * ethPriceUsd;

  if (ethBalanceUsd >= config.gas_low_threshold_usd) {
    return; // Gas is sufficient
  }

  console.log(
    `[GAS] Server ETH low: ${ethBalanceFloat.toFixed(4)} ETH (~$${ethBalanceUsd.toFixed(2)}), threshold: $${config.gas_low_threshold_usd}`
  );

  // Check server USDC balance
  const { balance: usdcBalance } = await getTokenBalance(
    chainConfig.usdc,
    serverAddress,
    provider
  );

  const swapAmountUsdc = ethers.parseUnits(
    config.gas_swap_amount_usd.toString(),
    usdcDecimals
  );

  if (usdcBalance < swapAmountUsdc) {
    console.warn(
      `[GAS] Server USDC insufficient for gas swap: ${ethers.formatUnits(usdcBalance, usdcDecimals)} < ${config.gas_swap_amount_usd}`
    );
    return;
  }

  // Approve router to spend USDC
  const router = new ethers.Contract(
    chainConfig.router,
    UNISWAP_V2_ROUTER_ABI,
    serverWallet
  );
  const usdc = new ethers.Contract(chainConfig.usdc, ERC20_ABI, serverWallet);

  const allowance: bigint = await usdc.allowance(serverAddress, chainConfig.router);
  if (allowance < swapAmountUsdc) {
    console.log("[GAS] Approving router to spend USDC...");
    const approveTx = await usdc.approve(chainConfig.router, ethers.MaxUint256);
    await approveTx.wait();
  }

  // Get expected output with 2% slippage tolerance
  const path = [chainConfig.usdc, chainConfig.weth];
  const amounts: bigint[] = await router.getAmountsOut(swapAmountUsdc, path);
  const expectedEth = amounts[1];
  const minEthOut = (expectedEth * 98n) / 100n; // 2% slippage

  const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

  console.log(
    `[GAS] Swapping $${config.gas_swap_amount_usd} USDC for ~${ethers.formatEther(expectedEth)} ETH...`
  );

  const tx = await router.swapExactTokensForETH(
    swapAmountUsdc,
    minEthOut,
    path,
    serverAddress,
    deadline
  );
  const receipt = await tx.wait();

  const newBalance = await provider.getBalance(serverAddress);
  console.log(
    `[GAS] Swapped $${config.gas_swap_amount_usd} USDC for ETH. New balance: ${ethers.formatEther(newBalance)} ETH (tx: ${receipt?.hash})`
  );
}
