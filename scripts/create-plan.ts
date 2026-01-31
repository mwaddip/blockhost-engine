import { ethers } from "hardhat";

async function main() {
  const contractAddress = process.env.BLOCKHOST_CONTRACT!;
  const contract = await ethers.getContractAt("BlockhostSubscriptions", contractAddress);

  console.log("Creating plan on:", contractAddress);
  const tx = await contract.createPlan("Basic", 1000n); // $10/day
  await tx.wait();
  console.log("Plan created: Basic @ $10/day");
}

main().catch(console.error);
