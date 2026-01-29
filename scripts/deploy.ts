import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  // Deploy the contract
  const BlockhostSubscriptions = await ethers.getContractFactory("BlockhostSubscriptions");
  const contract = await BlockhostSubscriptions.deploy();

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("BlockhostSubscriptions deployed to:", address);

  // Set primary stablecoin if SEPOLIA_USDC is provided
  const stablecoinAddress = process.env.SEPOLIA_USDC;
  if (stablecoinAddress) {
    console.log("Setting primary stablecoin to:", stablecoinAddress);
    const tx = await contract.setPrimaryStablecoin(stablecoinAddress);
    await tx.wait();
    console.log("Primary stablecoin set successfully");
  }

  console.log("\nDeployment complete!");
  console.log("Contract address:", address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
