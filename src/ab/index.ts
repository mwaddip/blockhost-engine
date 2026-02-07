#!/usr/bin/env node
/**
 * ab (addressbook) CLI — manage wallet entries in /etc/blockhost/addressbook.json
 *
 * Usage:
 *   ab add <name> <0xaddress>    Add new entry
 *   ab del <name>                Delete entry
 *   ab up <name> <0xaddress>     Update entry's address
 *   ab new <name>                Generate new wallet, save key, add to addressbook
 *   ab list                      Show all entries
 *
 * Reserved roles (immutable): server, admin, hot, dev, broker
 */

import { addCommand } from "./commands/add";
import { delCommand } from "./commands/del";
import { upCommand } from "./commands/up";
import { newCommand } from "./commands/new";
import { listCommand } from "./commands/list";

export const IMMUTABLE_ROLES = new Set(["server", "admin", "hot", "dev", "broker"]);

function printUsage(): void {
  console.log("ab (addressbook) — manage wallet entries in addressbook.json");
  console.log("");
  console.log("Usage:");
  console.log("  ab add <name> <0xaddress>    Add new entry");
  console.log("  ab del <name>                Delete entry");
  console.log("  ab up <name> <0xaddress>     Update entry's address");
  console.log("  ab new <name>                Generate new wallet and add to addressbook");
  console.log("  ab list                      Show all entries");
  console.log("");
  console.log("Reserved roles (immutable): server, admin, hot, dev, broker");
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  switch (command) {
    case "add":
      await addCommand(args);
      break;
    case "del":
      await delCommand(args);
      break;
    case "up":
      await upCommand(args);
      break;
    case "new":
      await newCommand(args);
      break;
    case "list":
      listCommand();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
