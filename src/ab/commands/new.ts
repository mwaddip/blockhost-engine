/**
 * ab new <name> — Generate new wallet, save key, add to addressbook
 */

import { loadAddressbook, saveAddressbook } from "../../fund-manager/addressbook";
import { generateWallet } from "../../fund-manager/wallet";
import { IMMUTABLE_ROLES } from "../index";

export function newCommand(args: string[]): void {
  if (args.length !== 1) {
    console.error("Usage: ab new <name>");
    process.exit(1);
  }

  const [name] = args;

  if (IMMUTABLE_ROLES.has(name)) {
    console.error(`Error: '${name}' is a reserved system role and cannot be modified.`);
    process.exit(1);
  }

  const book = loadAddressbook();

  if (book[name]) {
    console.error(`Error: '${name}' already exists in addressbook.`);
    process.exit(1);
  }

  const keyfilePath = `/etc/blockhost/${name}.key`;
  const { address } = generateWallet(keyfilePath);

  book[name] = { address, keyfile: keyfilePath };
  saveAddressbook(book);
  console.log(`Generated wallet '${name}' → ${address}`);
  console.log(`Key saved to ${keyfilePath}`);
}
