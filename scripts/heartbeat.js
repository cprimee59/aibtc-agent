#!/usr/bin/env node
/**
 * AIBTC Heartbeat — Hyper Isle
 * Signs "AIBTC Check-In | {timestamp}" with BIP-322 and POSTs to aibtc.com/api/heartbeat
 */

const { mnemonicToSeedSync } = require('@scure/bip39');
const { HDKey } = require('@scure/bip32');
const { ECPairFactory } = require('ecpair');
const tinysecp = require('tiny-secp256k1');
const { Signer } = require('bip322-js');

const ECPair = ECPairFactory(tinysecp);

const BTC_ADDRESS = 'bc1qh6ujcgsyjwvawsapghmu06a7szaytaju666hst';
const MNEMONIC = process.env.WALLET_MNEMONIC;

if (!MNEMONIC) {
  console.error('ERROR: WALLET_MNEMONIC environment variable not set');
  process.exit(1);
}

function deriveWIF() {
  const seed = mnemonicToSeedSync(MNEMONIC);
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive("m/84'/0'/0'/0/0");
  const keyPair = ECPair.fromPrivateKey(Buffer.from(child.privateKey), { compressed: true });
  return keyPair.toWIF();
}

async function sendHeartbeat() {
  const now = new Date();
  const timestamp = now.toISOString().replace(/\.\d{3}Z$/, '.000Z');
  const message = `AIBTC Check-In | ${timestamp}`;

  console.log(`Signing message: "${message}"`);
  const wif = deriveWIF();
  const signature = Signer.sign(wif, BTC_ADDRESS, message);
  console.log(`Signature: ${signature.slice(0, 30)}...`);

  const res = await fetch('https://aibtc.com/api/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ btcAddress: BTC_ADDRESS, message, signature, timestamp }),
  });

  const result = await res.json();
  if (result.success) {
    console.log(`✅ Heartbeat #${result.checkIn.checkInCount} recorded at ${timestamp}`);
  } else {
    console.error('❌ Heartbeat failed:', JSON.stringify(result));
    process.exit(1);
  }
}

sendHeartbeat().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
