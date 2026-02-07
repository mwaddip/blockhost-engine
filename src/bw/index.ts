#!/usr/bin/env node
/**
 * bw (blockwallet) CLI — scriptable wallet operations for blockhost
 *
 * Usage:
 *   bw send <amount> <token> <from> <to>
 *   bw balance <role> [token]
 *   bw split <amount> <token> <ratios> <from> <to1> <to2> ...
 *
 * Environment:
 *   SEPOLIA_RPC          — RPC endpoint URL
 *   BLOCKHOST_CONTRACT   — Subscription contract address
 */

import { loadAddressbook } from "../fund-manager/addressbook";
import { createProviderAndContract } from "./cli-utils";
import { sendCommand } from "./commands/send";
import { balanceCommand } from "./commands/balance";
import { splitCommand } from "./commands/split";

function printUsage(): void {
  console.log("bw (blockwallet) — scriptable wallet operations for blockhost");
  console.log("");
  console.log("Usage:");
  console.log("  bw send <amount> <token> <from> <to>      Send tokens");
  console.log("  bw balance <role> [token]                  Show balances");
  console.log("  bw split <amount> <token> <ratios> <from> <to1> <to2> ...");
  console.log("                                             Split tokens");
  console.log("");
  console.log("Token shortcuts: eth, stable, or 0x address");
  console.log("Roles: admin, server, hot, dev, broker (from addressbook.json)");
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  const book = loadAddressbook();
  if (Object.keys(book).length === 0) {
    console.error("Error: addressbook is empty or missing. Run the installer wizard first.");
    process.exit(1);
  }

  const { provider, contract } = createProviderAndContract();

  switch (command) {
    case "send":
      await sendCommand(args, book, provider, contract);
      break;
    case "balance":
      await balanceCommand(args, book, provider, contract);
      break;
    case "split":
      await splitCommand(args, book, provider, contract);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message || err}`);
  process.exit(1);
});
