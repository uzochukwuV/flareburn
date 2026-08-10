/**
 * Smart Accounts memo / PackedUserOperation builder.
 *
 * Builds the XRPL memo payload for the memo-field custom instruction (opcode 0xFF),
 * which lets an XRPL user mint FXRP and execute an action on Flare in a single
 * XRPL Payment — atomically. If the action reverts, no FXRP is minted.
 *
 * Memo layout (0xFF, memo-field custom instruction):
 *   byte 0:      instructionId = 0xFF
 *   byte 1:      walletId (1 byte; 0 if not registered with the operator)
 *   bytes 2-9:   executorFeeUBA (big-endian uint64, in the FAsset's smallest unit)
 *   bytes 10+:   abi.encode(PackedUserOperation)
 *
 * PackedUserOperation only validates three fields on-chain:
 *   sender    = getPersonalAccount(xrplAddress)  (the user's Flare smart account)
 *   nonce     = getNonce(personalAccount)
 *   callData  = abi.encodeCall(IPersonalAccount.executeUserOp, (calls))
 *
 * callData encodes a batch of Call structs:
 *   struct Call { address target; uint256 value; bytes data; }
 *
 * Sources:
 *   https://dev.flare.network/smart-accounts/memo-field-custom-instruction
 *   https://dev.flare.network/smart-accounts/custom-instruction
 *   IPersonalAccount.sol (flare-foundry-periphery-package)
 */

import { ethers } from "ethers";

/** A single call dispatched by the personal account's executeUserOp. */
export interface Call {
  target: string; // Flare 0x address
  value: bigint; // wei to forward with the call
  data: string; // 0x-prefixed call data
}

/** Fields required for a Flare Smart Accounts PackedUserOperation. */
export interface PackedUserOperation {
  sender: string; // personal account address
  nonce: bigint; // personal account nonce
  callData: string; // abi.encodeCall(executeUserOp, (calls))
  // Remaining EIP-4337 fields are not validated on-chain; omitted.
}

/** Memo-field custom instruction (opcode 0xFF) parameters. */
export interface MemoCustomInstruction {
  walletId: number; // 0 if not registered
  executorFeeUba: bigint; // executor fee in FAsset smallest unit (0 for 0xFF single-actor)
  userOp: PackedUserOperation;
}

/** IPersonalAccount.executeUserOp(Call[]) — minimal ABI fragment. */
const IPERSONAL_ACCOUNT_ABI = [
  {
    type: "function",
    name: "executeUserOp",
    stateMutability: "payable",
    inputs: [
      {
        name: "_calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

/** PackedUserOperation struct for ABI encoding (only the 3 validated fields matter). */
const PACKED_USER_OP_TYPES = [
  "tuple(address sender, uint256 nonce, bytes callData, bytes initCode, bytes accountGasLimits, uint256 preVerificationGas, uint256 gasFees, bytes paymasterAndData, bytes signature) userOp",
] as const;

/** Instruction opcodes used in smart-account memos. */
export const OPCODE = {
  CUSTOM_INSTRUCTION: 0xfe, // hash-commit; executor delivers bytes
  MEMO_FIELD_CUSTOM_INSTRUCTION: 0xff, // full userOp inline in memo
  SKIP_MEMO: 0xe0, // recover a stuck payment
  FAST_FORWARD_NONCE: 0xe1,
  REPLACE_EXECUTOR_FEE: 0xe2,
} as const;

/** 8-byte instruction prefix for plain direct minting memos (recipient only). */
export const DIRECT_MINTING_PREFIX = "0x4642505266410018";
/** 8-byte prefix for extended direct minting memos (recipient + executor). */
export const DIRECT_MINTING_EX_PREFIX = "0x4642505266410021";

/**
 * Build the callData field: abi.encodeCall(IPersonalAccount.executeUserOp, (calls)).
 * The personal account dispatches each call with itself as msg.sender.
 */
export function buildCallData(calls: Call[]): string {
  const iface = new ethers.Interface(IPERSONAL_ACCOUNT_ABI as any);
  return iface.encodeFunctionData("executeUserOp", [
    calls.map((c) => ({ target: c.target, value: c.value, data: c.data })),
  ]);
}

/** Build a PackedUserOperation from a sender, nonce, and a call batch. */
export function buildPackedUserOp(
  sender: string,
  nonce: bigint,
  calls: Call[],
): PackedUserOperation {
  return {
    sender,
    nonce,
    callData: buildCallData(calls),
  };
}

/** abi.encode(PackedUserOperation) — only sender, nonce, callData are validated. */
export function encodePackedUserOp(userOp: PackedUserOperation): string {
  const coder = new ethers.AbiCoder();
  return coder.encode(
    PACKED_USER_OP_TYPES,
    [
      {
        sender: userOp.sender,
        nonce: userOp.nonce,
        callData: userOp.callData,
        initCode: "0x",
        accountGasLimits: "0x",
        preVerificationGas: 0n,
        gasFees: 0n,
        paymasterAndData: "0x",
        signature: "0x",
      },
    ],
  );
}

/**
 * Build the full 0xFF memo payload (hex string without 0x) to place in the
 * XRPL Payment MemoData field.
 *
 * Layout: [0xFF][walletId:1][executorFeeUba:8 big-endian][abi.encode(userOp)]
 */
export function buildMemoCustomInstruction(
  instr: MemoCustomInstruction,
): string {
  if (instr.walletId < 0 || instr.walletId > 255) {
    throw new Error(`walletId must fit in 1 byte (0-255), got ${instr.walletId}`);
  }
  const header = new Uint8Array(10);
  header[0] = OPCODE.MEMO_FIELD_CUSTOM_INSTRUCTION;
  header[1] = instr.walletId;
  const view = new DataView(header.buffer);
  view.setBigUint64(2, instr.executorFeeUba, false); // big-endian

  const userOpEncoded = encodePackedUserOp(instr.userOp);
  const userOpBytes = ethers.getBytes(userOpEncoded);

  const memo = new Uint8Array(header.length + userOpBytes.length);
  memo.set(header, 0);
  memo.set(userOpBytes, header.length);

  // XRPL MemoData is hex without 0x prefix.
  return ethers.hexlify(memo).slice(2);
}

/** Inverse of buildMemoCustomInstruction — decode an 0xFF memo for inspection. */
export function decodeMemoCustomInstruction(memoHex: string): {
  opcode: number;
  walletId: number;
  executorFeeUba: bigint;
  userOpEncoded: string;
} {
  const clean = memoHex.startsWith("0x") ? memoHex.slice(2) : memoHex;
  const bytes = ethers.getBytes("0x" + clean);
  if (bytes.length < 10) {
    throw new Error(`memo too short for 0xFF instruction: ${bytes.length} bytes`);
  }
  const opcode = bytes[0];
  if (opcode !== OPCODE.MEMO_FIELD_CUSTOM_INSTRUCTION) {
    throw new Error(
      `not a memo-field custom instruction: opcode 0x${opcode.toString(16)} (expected 0xff)`,
    );
  }
  const walletId = bytes[1];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const executorFeeUba = view.getBigUint64(2, false);
  const userOpEncoded = ethers.hexlify(bytes.slice(10));
  return { opcode, walletId, executorFeeUba, userOpEncoded };
}

/**
 * Build a plain direct-minting memo (no smart-account action).
 * 32-byte format: [prefix 8][zero padding 4][recipient 20] — anyone can execute.
 */
export function buildDirectMintingMemo(recipient: string): string {
  if (!ethers.isAddress(recipient)) {
    throw new Error(`Invalid recipient address: ${recipient}`);
  }
  const recipientBytes = ethers.getBytes(recipient); // 20 bytes
  const prefixBytes = ethers.getBytes(DIRECT_MINTING_PREFIX); // 8 bytes
  const padding = new Uint8Array(4); // 4 zero bytes
  const memo = new Uint8Array(32);
  memo.set(prefixBytes, 0);
  memo.set(padding, 8);
  memo.set(recipientBytes, 12);
  return ethers.hexlify(memo).slice(2);
}
