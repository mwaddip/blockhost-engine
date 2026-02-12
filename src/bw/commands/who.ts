/**
 * bw who <identifier>
 *
 * Query the owner of an AccessCredentialNFT by token ID.
 * Identifier is either a numeric token ID or "admin" (resolved from blockhost.yaml).
 *
 * Reads nft_contract and rpc_url from web3-defaults.yaml,
 * and admin.credential_nft_id from blockhost.yaml.
 */

import * as fs from "fs";
import * as yaml from "js-yaml";
import { ethers } from "ethers";

const WEB3_DEFAULTS_PATH = "/etc/blockhost/web3-defaults.yaml";
const BLOCKHOST_CONFIG_PATH = "/etc/blockhost/blockhost.yaml";

const NFT_ABI = ["function ownerOf(uint256 tokenId) view returns (address)"];

interface Web3Config {
  nftContract: string;
  rpcUrl: string;
}

function loadWeb3Config(): Web3Config {
  if (!fs.existsSync(WEB3_DEFAULTS_PATH)) {
    throw new Error(`Config not found: ${WEB3_DEFAULTS_PATH}`);
  }

  const raw = yaml.load(fs.readFileSync(WEB3_DEFAULTS_PATH, "utf8")) as Record<string, unknown>;
  const blockchain = raw.blockchain as Record<string, unknown> | undefined;

  const nftContract = blockchain?.nft_contract as string | undefined;
  if (!nftContract || !ethers.isAddress(nftContract)) {
    throw new Error("blockchain.nft_contract not set or invalid in web3-defaults.yaml");
  }

  const rpcUrl = blockchain?.rpc_url as string | undefined;
  if (!rpcUrl) {
    throw new Error("blockchain.rpc_url not set in web3-defaults.yaml");
  }

  return { nftContract, rpcUrl };
}

function loadAdminNftId(): number {
  if (!fs.existsSync(BLOCKHOST_CONFIG_PATH)) {
    throw new Error(`Config not found: ${BLOCKHOST_CONFIG_PATH}`);
  }

  const raw = yaml.load(fs.readFileSync(BLOCKHOST_CONFIG_PATH, "utf8")) as Record<string, unknown>;
  const admin = raw.admin as Record<string, unknown> | undefined;

  if (!admin || admin.credential_nft_id === undefined || admin.credential_nft_id === null) {
    throw new Error("admin.credential_nft_id not set in blockhost.yaml");
  }

  const id = Number(admin.credential_nft_id);
  if (!Number.isInteger(id) || id < 0) {
    throw new Error(`Invalid admin.credential_nft_id: ${admin.credential_nft_id}`);
  }

  return id;
}

/**
 * CLI handler
 */
export async function whoCommand(args: string[]): Promise<void> {
  if (args.length < 1) {
    console.error("Usage: bw who <identifier>");
    console.error("  identifier: token ID (0, 1, 2, ...) or 'admin'");
    process.exit(1);
  }

  const identifier = args[0];

  let tokenId: number;
  if (identifier === "admin") {
    tokenId = loadAdminNftId();
  } else if (/^\d+$/.test(identifier)) {
    tokenId = parseInt(identifier, 10);
  } else {
    console.error(`Invalid identifier: '${identifier}'. Use a token ID or 'admin'.`);
    process.exit(1);
  }

  const { nftContract, rpcUrl } = loadWeb3Config();
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(nftContract, NFT_ABI, provider);

  try {
    const owner: string = await contract.ownerOf(tokenId);
    console.log(owner);
  } catch {
    console.error(`Error: token ${tokenId} does not exist`);
    process.exit(1);
  }
}
