/**
 * Test script to create a plan and buy a subscription
 * This will trigger events that the monitor should pick up
 */

import { ethers } from "ethers";

const CONTRACT_ABI = [
  "function setPrimaryStablecoin(address stablecoinAddress) external",
  "function createPlan(string name, uint256 pricePerDayUsdCents) external returns (uint256)",
  "function buySubscription(uint256 planId, uint256 days, uint256 paymentMethodId) external",
  "function owner() view returns (address)",
  "function getPrimaryStablecoin() view returns (address)",
  "function getPlan(uint256 planId) view returns (tuple(string name, uint256 pricePerDayUsdCents, bool active, uint256 createdAt))",
  "function getPaymentMethod(uint256 paymentMethodId) view returns (tuple(address tokenAddress, address pairAddress, address stablecoinAddress, bool active))",
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

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, wallet);
  const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, wallet);

  console.log("=== Test Subscription Flow ===\n");
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Contract: ${contractAddress}`);
  console.log(`USDC: ${usdcAddress}\n`);

  // Check USDC balance
  const decimals = await usdc.decimals();
  const balance = await usdc.balanceOf(wallet.address);
  console.log(`USDC Balance: ${ethers.formatUnits(balance, decimals)} USDC`);

  // Step 1: Check/Set primary stablecoin
  console.log("\n--- Step 1: Check Primary Stablecoin ---");
  const currentStablecoin = await contract.getPrimaryStablecoin();
  console.log(`Current primary stablecoin: ${currentStablecoin}`);

  if (currentStablecoin === ethers.ZeroAddress) {
    console.log("Setting primary stablecoin to USDC...");
    const tx1 = await contract.setPrimaryStablecoin(usdcAddress);
    console.log(`TX: ${tx1.hash}`);
    await tx1.wait();
    console.log("Primary stablecoin set!");
  } else {
    console.log("Primary stablecoin already set.");
  }

  // Step 2: Create a plan (1 USD/day = 100 cents)
  console.log("\n--- Step 2: Create Plan ---");
  console.log("Creating plan: 'Test Plan' at $1.00/day (100 cents)...");
  const tx2 = await contract.createPlan("Test Plan", 100);
  console.log(`TX: ${tx2.hash}`);
  const receipt2 = await tx2.wait();

  // Get plan ID from event
  const planCreatedEvent = receipt2?.logs.find((log: any) => {
    try {
      const parsed = contract.interface.parseLog({ topics: log.topics as string[], data: log.data });
      return parsed?.name === "PlanCreated";
    } catch { return false; }
  });

  let planId = 1n;
  if (planCreatedEvent) {
    const parsed = contract.interface.parseLog({
      topics: planCreatedEvent.topics as string[],
      data: planCreatedEvent.data
    });
    planId = parsed?.args[0];
  }
  console.log(`Plan created with ID: ${planId}`);

  // Step 3: Approve USDC spending
  console.log("\n--- Step 3: Approve USDC ---");
  const daysToSubscribe = 7n;
  const costCents = 100n * daysToSubscribe; // $1/day * 7 days = $7.00
  const costUsdc = costCents * (10n ** BigInt(decimals)) / 100n; // Convert cents to USDC units
  console.log(`Subscription cost: ${ethers.formatUnits(costUsdc, decimals)} USDC for ${daysToSubscribe} days`);

  const currentAllowance = await usdc.allowance(wallet.address, contractAddress);
  if (currentAllowance < costUsdc) {
    console.log("Approving USDC spend...");
    const tx3 = await usdc.approve(contractAddress, costUsdc);
    console.log(`TX: ${tx3.hash}`);
    await tx3.wait();
    console.log("USDC approved!");
  } else {
    console.log("USDC already approved.");
  }

  // Step 4: Buy subscription
  console.log("\n--- Step 4: Buy Subscription ---");
  console.log(`Buying ${daysToSubscribe}-day subscription to plan ${planId}...`);
  const tx4 = await contract.buySubscription(planId, daysToSubscribe, 1); // paymentMethodId 1 = primary stablecoin
  console.log(`TX: ${tx4.hash}`);
  await tx4.wait();
  console.log("Subscription purchased!");

  console.log("\n=== Done! Check the monitor logs on ix ===");
  console.log("Run: ssh root@ix journalctl -u blockhost-monitor -f");
}

main().catch(console.error);
