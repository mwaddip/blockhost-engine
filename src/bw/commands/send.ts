/**
 * bw send <amount> <token> <from> <to>
 *
 * Send tokens from a signing wallet to a recipient
 */

import { ethers } from "ethers";
import type { Addressbook } from "../../fund-manager/types";
import { resolveAddress, resolveWallet } from "../../fund-manager/addressbook";
import { transferToken, ERC20_ABI } from "../../fund-manager/token-utils";
import { resolveToken } from "../cli-utils";

export async function sendCommand(
  args: string[],
  book: Addressbook,
  provider: ethers.JsonRpcProvider,
  contract: ethers.Contract
): Promise<void> {
  if (args.length < 4) {
    console.error("Usage: bw send <amount> <token> <from> <to>");
    console.error("  Example: bw send 1 eth hot admin");
    console.error("  Example: bw send 100 stable server hot");
    process.exit(1);
  }

  const [amountStr, tokenArg, fromRole, toRole] = args;
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    console.error(`Invalid amount: ${amountStr}`);
    process.exit(1);
  }

  // Resolve sender (needs keyfile)
  const signer = resolveWallet(fromRole, book, provider);
  if (!signer) {
    process.exit(1);
  }

  // Resolve recipient
  const toAddress = resolveAddress(toRole, book);
  if (!toAddress) {
    process.exit(1);
  }

  // Resolve token
  const resolved = await resolveToken(tokenArg, contract);

  if (resolved.isNative) {
    // Send native ETH
    const weiAmount = ethers.parseEther(amountStr);
    console.log(`Sending ${amountStr} ETH from ${fromRole} to ${toRole} (${toAddress})...`);
    const tx = await signer.sendTransaction({
      to: toAddress,
      value: weiAmount,
    });
    const receipt = await tx.wait();
    console.log(`Sent. tx: ${receipt?.hash}`);
  } else {
    // Send ERC20 token
    const token = new ethers.Contract(resolved.address, ERC20_ABI, provider);
    const decimals = Number(await token.decimals());
    const symbol: string = await token.symbol();
    const tokenAmount = ethers.parseUnits(amountStr, decimals);

    console.log(
      `Sending ${amountStr} ${symbol} from ${fromRole} to ${toRole} (${toAddress})...`
    );
    const receipt = await transferToken(
      resolved.address,
      toAddress,
      tokenAmount,
      signer
    );
    console.log(`Sent. tx: ${receipt?.hash}`);
  }
}
