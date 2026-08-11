/**
 * Sign + broadcast a prepared XRPL Payment to the Core Vault.
 * Usage: tsx scripts/xrpl-submit-payment.ts '<json-payment>'
 *   where <json-payment> is the "payment" object from /prepare-payment.
 *
 * Env: XRP_SECRET (the XRPL wallet family seed)
 */
import { Client, Wallet, xrpToDrops } from "xrpl";

const paymentJson = process.argv[2];
if (!paymentJson) {
  console.error("Usage: tsx scripts/xrpl-submit-payment.ts '<json-payment>'");
  process.exit(1);
}

const secret = process.env.XRP_SECRET;
if (!secret) {
  console.error("XRP_SECRET not set");
  process.exit(1);
}

const ENDPOINT = process.env.XRPL_ENDPOINT ?? "wss://s.altnet.rippletest.net:51233";

async function main() {
  const payment = JSON.parse(paymentJson);
  console.log("=== Signing XRPL Payment ===");
  console.log(`  From: ${payment.Account}`);
  console.log(`  To:   ${payment.Destination}`);
  const amtStr: string = (payment.Amount ?? payment.DeliverMax) as string;
  console.log(`  Amount: ${Number(amtStr) / 1_000_000} XRP (${amtStr} drops)`);
  console.log(`  Fee:  ${payment.Fee} drops`);
  if (payment.Memos) {
    console.log(`  Memo: ${payment.Memos[0].Memo.MemoData}`);
  }

  const client = new Client(ENDPOINT);
  await client.connect();
  console.log(`\nConnected to ${ENDPOINT}`);

  const wallet = Wallet.fromSeed(secret as string);
  console.log(`Wallet address: ${wallet.address}`);

  if (wallet.address !== payment.Account) {
    console.error(`ERROR: wallet address ${wallet.address} does not match payment Account ${payment.Account}`);
    await client.disconnect();
    process.exit(1);
  }

  // Check balance before
  try {
    const info = await client.request({ command: "account_info", account: wallet.address });
    const bal = Number(info.result.account_data.Balance) / 1_000_000;
    console.log(`Current balance: ${bal} XRP`);
  } catch {
    console.log("Account not found on ledger — may need funding");
  }

  // Build the transaction. xrpl.js v4 requires Sequence, LastLedgerSequence, etc.
  // Use client.autofill() to populate them automatically.
  const tx: any = {
    TransactionType: "Payment",
    Account: payment.Account,
    Destination: payment.Destination,
    Amount: payment.Amount,
    Fee: payment.Fee,
    Memos: payment.Memos,
  };
  if (payment.DestinationTag !== undefined) tx.DestinationTag = payment.DestinationTag;

  const prepared = await client.autofill(tx);
  console.log("\nSigned transaction (autofilled)...");
  const signed = wallet.sign(prepared);
  console.log(`Signed tx hash: ${signed.hash}`);

  console.log("Submitting to XRPL...");
  const submitResult = await client.submitAndWait(signed.tx_blob);
  console.log(`\n=== Transaction Result ===`);
  console.log(`  Hash: ${signed.hash}`);
  const meta = (submitResult as any).result?.meta;
  if (meta) {
    console.log(`  Status: ${meta.TransactionResult}`);
    console.log(`  Ledger index: ${(submitResult as any).result.ledger_index}`);
  }
  console.log(`\n  TX_HASH=${signed.hash}`);

  await client.disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
