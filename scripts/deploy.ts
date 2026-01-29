import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  const BlockhostSubscriptions = await ethers.getContractFactory("BlockhostSubscriptions");
  const contract = await BlockhostSubscriptions.deploy();

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("BlockhostSubscriptions deployed to:", address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
