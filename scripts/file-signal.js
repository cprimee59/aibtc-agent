#!/usr/bin/env node
/**
 * AIBTC Signal Filer — Hyper Isle
 * Fetches live data, generates a signal via Claude API, signs with BIP-322, posts to aibtc.news
 *
 * Usage:
 *   BEAT=quantum node scripts/file-signal.js
 *   BEAT=agent-economy node scripts/file-signal.js
 */

const { mnemonicToSeedSync } = require('@scure/bip39');
const { HDKey } = require('@scure/bip32');
const { ECPairFactory } = require('ecpair');
const tinysecp = require('tiny-secp256k1');
const { Signer } = require('bip322-js');
const Anthropic = require('@anthropic-ai/sdk');

const ECPair = ECPairFactory(tinysecp);

const BTC_ADDRESS = 'bc1qh6ujcgsyjwvawsapghmu06a7szaytaju666hst';
const MNEMONIC = process.env.WALLET_MNEMONIC;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BEAT = process.env.BEAT || 'quantum';

if (!MNEMONIC || !ANTHROPIC_API_KEY) {
  console.error('ERROR: WALLET_MNEMONIC and ANTHROPIC_API_KEY must be set');
  process.exit(1);
}

function deriveWIF() {
  const seed = mnemonicToSeedSync(MNEMONIC);
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive("m/84'/0'/0'/0/0");
  return ECPair.fromPrivateKey(Buffer.from(child.privateKey), { compressed: true }).toWIF();
}

function makeAuthHeaders() {
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');
  const wif = deriveWIF();
  const signature = Signer.sign(wif, BTC_ADDRESS, timestamp);
  return {
    'X-BTC-Address': BTC_ADDRESS,
    'X-BTC-Timestamp': timestamp,
    'X-BTC-Signature': signature,
    'Content-Type': 'application/json',
  };
}

async function fetchLiveData(beat) {
  const data = {};

  // Always fetch network status
  try {
    const res = await fetch('https://api.mainnet.hiro.so/v2/info');
    const json = await res.json();
    data.stacksBlock = json.stacks_tip_height;
    data.btcBlock = json.burn_block_height;
  } catch (e) {
    data.stacksBlock = 'unknown';
    data.btcBlock = 'unknown';
  }

  if (beat === 'quantum') {
    try {
      const res = await fetch('https://quantum-power-map.p-d07.workers.dev/data.json');
      data.quantum = await res.json();
    } catch (e) {
      data.quantum = null;
    }
  }

  if (beat === 'agent-economy') {
    try {
      const res = await fetch('https://bounty.drx4.xyz/api/stats');
      data.bounty = await res.json();
    } catch (e) {
      data.bounty = null;
    }
    try {
      const res = await fetch('https://api.aibtc.com/identity/last-id');
      const json = await res.json();
      data.agentCount = json.lastId;
    } catch (e) {
      data.agentCount = null;
    }
  }

  return data;
}

async function generateSignal(beat, liveData) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const beatPrompts = {
    quantum: `You are a Bitcoin news correspondent filing a signal on the "quantum" beat at aibtc.news.
Live data: ${JSON.stringify(liveData, null, 2)}

File a signal about Bitcoin's quantum preparedness using the Quantum Readiness Index data above.
Focus on specific numbers, developer scores, and what has changed since the last report.
Anchor to Stacks block ${liveData.stacksBlock} and Bitcoin block ${liveData.btcBlock}.`,

    'agent-economy': `You are a Bitcoin news correspondent filing a signal on the "agent-economy" beat at aibtc.news.
Live data: ${JSON.stringify(liveData, null, 2)}

File a signal about the AIBTC agent economy: bounty stats, agent registrations, x402 flows, sBTC activity.
Focus on specific numbers and structural trends. Anchor to Stacks block ${liveData.stacksBlock} and Bitcoin block ${liveData.btcBlock}.`,
  };

  const systemPrompt = `You produce JSON only. Output a single JSON object with these fields:
- headline: string, max 120 chars, declarative with specific numbers
- body: string, max 1000 chars, evidence-dense, anchored to on-chain data
- sources: array of 2-3 objects with {url, title}
- tags: array of 3-6 lowercase tag strings

Rules:
- Every claim must be verifiable from the live data provided
- Include current block numbers in the body
- No speculation, only observable facts
- Disclosure will be added separately`;

  const msg = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: beatPrompts[beat] }],
  });

  const raw = msg.content[0].text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(raw);
}

async function fileSignal(beat, signal) {
  const headers = makeAuthHeaders();
  const payload = {
    beat_slug: beat,
    headline: signal.headline,
    body: signal.body,
    sources: signal.sources,
    tags: signal.tags,
    disclosure: 'claude-opus-4-6, aibtc MCP tools, GitHub Actions',
  };

  const res = await fetch('https://aibtc.news/api/signals', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  return res.json();
}

async function main() {
  console.log(`Filing signal on beat: ${BEAT}`);

  const liveData = await fetchLiveData(BEAT);
  console.log(`Live data fetched — Stacks block ${liveData.stacksBlock}, BTC block ${liveData.btcBlock}`);

  const signal = await generateSignal(BEAT, liveData);
  console.log(`Generated headline: "${signal.headline}"`);

  const result = await fileSignal(BEAT, signal);

  if (result.success) {
    console.log(`✅ Signal filed: ${result.signal.id}`);
    console.log(`   Status: ${result.signal.status}`);
  } else {
    console.error('❌ Signal filing failed:', JSON.stringify(result));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
