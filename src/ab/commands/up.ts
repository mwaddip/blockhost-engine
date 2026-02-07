/**
 * ab up <name> <0xaddress> — Update entry's address in addressbook
 */

import { ethers } from "ethers";
import { loadAddressbook, saveAddressbook } from "../../fund-manager/addressbook";
import { IMMUTABLE_ROLES } from "../index";

export function upCommand(args: string[]): void {
  if (args.length !== 2) {
    console.error("Usage: ab up <name> <0xaddress>");
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

  if (!book[name]) {
    console.error(`Error: '${name}' not found in addressbook. Use 'ab add ${name} <address>' to create.`);
    process.exit(1);
  }

  book[name].address = address;
  saveAddressbook(book);
  console.log(`Updated '${name}' → ${address}`);
}
