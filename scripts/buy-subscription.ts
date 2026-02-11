/**
 * Buy a subscription to an existing plan
 * Usage: npx tsx scripts/buy-subscription.ts [planId] [days]
 */

import { ethers } from "ethers";

const CONTRACT_ABI = [
  "function buySubscription(uint256 planId, uint256 days, uint256 paymentMethodId, bytes userEncrypted) external",
  "function getPlan(uint256 planId) view returns (string name, uint256 pricePerDayUsdCents, bool active)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

async function main() {
  const rpcUrl = process.env.RPC_URL;
  const contractAddress = process.env.BLOCKHOST_CONTRACT;
  const usdcAddress = process.env.SEPOLIA_USDC;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

  if (!rpcUrl || !contractAddress || !usdcAddress || !privateKey) {
    console.error("Missing environment variables. Source blockhost.env first.");
    process.exit(1);
  }

  // Parse arguments
  const planId = BigInt(process.argv[2] || "1");
  const days = BigInt(process.argv[3] || "7");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, wallet);
  const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, wallet);

  console.log("=== Buy Subscription ===\n");
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Plan ID: ${planId}`);
  console.log(`Days: ${days}\n`);

  // Get plan details
  const [planName, pricePerDayUsdCents, active] = await contract.getPlan(planId);
  console.log(`Plan: ${planName}`);
  console.log(`Price: $${Number(pricePerDayUsdCents) / 100}/day`);
  console.log(`Active: ${active}`);

  if (!active) {
    console.error("Plan is not active!");
    process.exit(1);
  }

  // Calculate cost
  const decimals = await usdc.decimals();
  const costCents = pricePerDayUsdCents * days;
  const costUsdc = costCents * (10n ** BigInt(decimals)) / 100n;
  console.log(`Total cost: ${ethers.formatUnits(costUsdc, decimals)} USDC\n`);

  // Check balance
  const balance = await usdc.balanceOf(wallet.address);
  console.log(`USDC Balance: ${ethers.formatUnits(balance, decimals)} USDC`);

  if (balance < costUsdc) {
    console.error("Insufficient USDC balance!");
    process.exit(1);
  }

  // Approve if needed
  const currentAllowance = await usdc.allowance(wallet.address, contractAddress);
  if (currentAllowance < costUsdc) {
    console.log("Approving USDC spend...");
    const tx1 = await usdc.approve(contractAddress, costUsdc);
    console.log(`TX: ${tx1.hash}`);
    await tx1.wait();
    console.log("Approved!\n");
  }

  // Buy subscription (passing empty userEncrypted - real encrypted data comes from signup page)
  console.log("Buying subscription...");
  const tx2 = await contract.buySubscription(planId, days, 1, "0x");
  console.log(`TX: ${tx2.hash}`);
  await tx2.wait();
  console.log("Subscription purchased!\n");

  console.log("=== Done! Check monitor logs: ssh root@ix journalctl -u blockhost-monitor -f ===");
}

main().catch(console.error);
