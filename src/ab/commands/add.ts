/**
 * ab add <name> <0xaddress> — Add new entry to addressbook
 */

import { ethers } from "ethers";
import { loadAddressbook, saveAddressbook } from "../../fund-manager/addressbook";
import { IMMUTABLE_ROLES } from "../index";

export async function addCommand(args: string[]): Promise<void> {
  if (args.length !== 2) {
    console.error("Usage: ab add <name> <0xaddress>");
    process.exit(1);
  }

  const [name, address] = args;

  if (IMMUTABLE_ROLES.has(name)) {
    console.error(`Error: '${name}' is a reserved system role and cannot be modified.`);
    process.exit(1);
  }

  if (!ethers.isAddress(address)) {
    console.error(`Error: '${address}' is not a valid Ethereum address.`);
    process.exit(1);
  }

  const book = loadAddressbook();

  if (book[name]) {
    console.error(`Error: '${name}' already exists. Use 'ab up ${name} <address>' to update.`);
    process.exit(1);
  }

  book[name] = { address };
  await saveAddressbook(book);
  console.log(`Added '${name}' → ${address}`);
}
