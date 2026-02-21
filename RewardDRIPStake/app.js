// app.js — RewardStakerUSDCDrip (ALT stake -> USDC rewards)

// ====== CONFIG ======
const FARM_ADDRESS = "0xC2A0E92F1fc5c0191ef9787c7eB53cbB5D08d6E6";

const ALT  = "0x90678C02823b21772fa7e91B27EE70490257567B"; // stake token
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // reward token

// DexScreener (Base) — ALT/WETH pair (gives priceUsd directly)
const DEX_CHAIN = "base";
const PAIR_ALT_WETH = "0xd57f6e7d7ec911ba8defcf93d3682bb76959e950";

// refresh cadence
const REFRESH_MS = 5 * 60 * 1000; // 5 minutes
const SECONDS_PER_DAY = 86_400n;

// ====== ABIs ======
// RewardStakerUSDCDrip ABI (only what UI needs)
const farmABI = [
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function claim()",
  "function pendingRewards(address) view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function users(address) view returns (uint256 amount, uint256 rewardDebt)",

  // helpers
  "function rewardBalance() view returns (uint256)",
  "function reserveBalance() view returns (uint256)",
  "function dailyDripEstimate() view returns (uint256)",
  "function yearlyDripEstimate() view returns (uint256)",

  // optional accounting helpers (if present in your deployed version)
  "function unclaimedAllocated() view returns (uint256)"
];

const erc20ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

// ====== STATE ======
let provider, signer, user, farm, alt, usdc;
let stakeDecimals = 18;
let rewardDecimals = 6;

let cachedAltPriceUsd = null;
let lastPriceTs = 0;

const $ = (id) => document.getElementById(id);

function safeSetText(id, text) {
  const el = $(id);
  if (el) el.innerText = text;
}

function fmtUsd(n) {
  if (n === null || Number.isNaN(n) || !Number.isFinite(n)) return "-";
  return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function fmtPct(n) {
  if (n === null || Number.isNaN(n) || !Number.isFinite(n)) return "-";
  return n.toFixed(2) + "%";
}

// Format on-chain units, but clamp to displayDecimals (e.g. 6) for nicer UI
function fmtUnitsClamped(valueWei, tokenDecimals, displayDecimals = 6) {
  try {
    const s = ethers.formatUnits(valueWei, tokenDecimals); // string
    if (!s.includes(".")) return s;
    const [a, b] = s.split(".");
    return `${a}.${b.slice(0, displayDecimals)}`;
  } catch {
    return "-";
  }
}

async function fetchDexScreenerPair(chain, pairAddress) {
  const url = `https://api.dexscreener.com/latest/dex/pairs/${chain}/${pairAddress}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
  const data = await res.json();
  if (!data || !data.pair) throw new Error("DexScreener: missing pair");
  return data.pair;
}

async function updatePrices() {
  const now = Date.now();
  if (now - lastPriceTs < 10_000) return;

  safeSetText("priceStatus", "Updating prices...");

  try {
    const altPair = await fetchDexScreenerPair(DEX_CHAIN, PAIR_ALT_WETH);

    // DexScreener returns USD price directly for this pair
    cachedAltPriceUsd = parseFloat(altPair.priceUsd);

    lastPriceTs = now;

    safeSetText("altPrice", fmtUsd(cachedAltPriceUsd));
    // if your HTML still has wethPrice from the old UI, leave it blank
    safeSetText("wethPrice", "-");

    safeSetText("priceStatus", `Prices updated: ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    console.error(e);
    safeSetText("priceStatus", "Price update failed (will retry next refresh)");
    // keep old cached price if available
  }
}

async function connect() {
  if (!window.ethereum) {
    alert("No wallet found. Install MetaMask / Coinbase Wallet.");
    return;
  }

  provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer = await provider.getSigner();
  user = await signer.getAddress();

  farm = new ethers.Contract(FARM_ADDRESS, farmABI, signer);
  alt  = new ethers.Contract(ALT, erc20ABI, signer);
  usdc = new ethers.Contract(USDC, erc20ABI, signer);

  stakeDecimals = await alt.decimals();
  rewardDecimals = await usdc.decimals(); // should be 6

  safeSetText("status", `Connected: ${user}`);

  await updatePrices();
  await refresh();

  setInterval(async () => {
    await updatePrices();
    await refresh();
  }, REFRESH_MS);
}

async function refresh() {
  if (!farm || !user) return;

  // Some deployments may not include unclaimedAllocated(); handle gracefully
  const calls = [
    farm.users(user),
    farm.pendingRewards(user),
    farm.totalStaked(),
    alt.balanceOf(user),
    farm.rewardBalance(),
    farm.reserveBalance(),
    farm.dailyDripEstimate(),
    farm.yearlyDripEstimate(),
  ];

  let unclaimedAllocated = null;
  try {
    calls.push(farm.unclaimedAllocated());
  } catch {
    // ignore
  }

  const results = await Promise.allSettled(calls);

  const u = results[0].status === "fulfilled" ? results[0].value : { amount: 0n, rewardDebt: 0n };
  const pending = results[1].status === "fulfilled" ? results[1].value : 0n;
  const total = results[2].status === "fulfilled" ? results[2].value : 0n;
  const altBal = results[3].status === "fulfilled" ? results[3].value : 0n;
  const rewardBal = results[4].status === "fulfilled" ? results[4].value : 0n;
  const reserveBal = results[5].status === "fulfilled" ? results[5].value : 0n;
  const dripPerDay = results[6].status === "fulfilled" ? results[6].value : 0n;
  const dripPerYear = results[7].status === "fulfilled" ? results[7].value : 0n;

  if (results[8] && results[8].status === "fulfilled") {
    unclaimedAllocated = results[8].value;
  }

  // Wallet + Staking
  safeSetText("stakeBal", fmtUnitsClamped(altBal, stakeDecimals, 6));
  safeSetText("staked", fmtUnitsClamped(u.amount, stakeDecimals, 6));
  safeSetText("pending", fmtUnitsClamped(pending, rewardDecimals, 6));
  safeSetText("totalStaked", fmtUnitsClamped(total, stakeDecimals, 6));

  // Rewards / Reserve UI helpers (add these IDs in your HTML if you want them shown)
  safeSetText("rewardBalance", fmtUnitsClamped(rewardBal, rewardDecimals, 6));
  safeSetText("reserveBalance", fmtUnitsClamped(reserveBal, rewardDecimals, 6));

  if (unclaimedAllocated !== null) {
    safeSetText("unclaimedAllocated", fmtUnitsClamped(unclaimedAllocated, rewardDecimals, 6));
  }

  // Emissions/day (USDC)
  safeSetText("emissions", fmtUnitsClamped(dripPerDay, rewardDecimals, 6));

  // APR + TVL (USD)
  try {
    if (cachedAltPriceUsd && total > 0n) {
      const totalStakedAlt = parseFloat(ethers.formatUnits(total, stakeDecimals));
      const tvlUsd = totalStakedAlt * cachedAltPriceUsd;

      // Rewards are USDC, assume $1 per USDC
      const yearlyRewardsUsdc = parseFloat(ethers.formatUnits(dripPerYear, rewardDecimals));
      const yearlyRewardsUsd = yearlyRewardsUsdc;

      const apr = tvlUsd > 0 ? (yearlyRewardsUsd / tvlUsd) * 100 : null;

      safeSetText("apr", fmtPct(apr));
      safeSetText("tvlUsd", fmtUsd(tvlUsd));
    } else {
      safeSetText("apr", "-");
      safeSetText("tvlUsd", "-");
    }
  } catch (e) {
    console.error(e);
    safeSetText("apr", "-");
    safeSetText("tvlUsd", "-");
  }
}

async function approveIfNeeded(amountWei) {
  const allowance = await alt.allowance(user, FARM_ADDRESS);
  if (allowance >= amountWei) return;

  const tx = await alt.approve(FARM_ADDRESS, amountWei);
  await tx.wait();
}

async function stake() {
  const val = $("depositAmount")?.value;
  if (!val || Number(val) <= 0) return alert("Enter stake amount");

  const amountWei = ethers.parseUnits(val, stakeDecimals);

  await approveIfNeeded(amountWei);

  const tx = await farm.deposit(amountWei);
  await tx.wait();

  if ($("depositAmount")) $("depositAmount").value = "";
  await refresh();
}

async function withdraw() {
  const val = $("withdrawAmount")?.value;
  if (!val || Number(val) <= 0) return alert("Enter withdraw amount");

  const amountWei = ethers.parseUnits(val, stakeDecimals);

  const tx = await farm.withdraw(amountWei);
  await tx.wait();

  if ($("withdrawAmount")) $("withdrawAmount").value = "";
  await refresh();
}

async function claim() {
  const tx = await farm.claim();
  await tx.wait();
  await refresh();
}

// ====== UI HOOKS ======
if ($("btnConnect")) $("btnConnect").onclick = connect;
if ($("btnDeposit")) $("btnDeposit").onclick = stake;
if ($("btnWithdraw")) $("btnWithdraw").onclick = withdraw;
if ($("btnClaim")) $("btnClaim").onclick = claim;
