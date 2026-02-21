// app.js — RewardStakerUSDCDrip (ALT stake -> USDC rewards)
// UI targets (from your simplified HTML):
// status, staked, pending, reserve, apr, lastUpdate
// buttons: btnConnect, btnDeposit, btnWithdraw, btnClaim, btnUpdate
// inputs: depositAmount, withdrawAmount

// ====== CONFIG ======
const FARM_ADDRESS = "0xC2A0E92F1fc5c0191ef9787c7eB53cbB5D08d6E6";

const ALT  = "0x90678C02823b21772fa7e91B27EE70490257567B"; // stake token
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // reward token

// DexScreener (Base) — ALT/WETH pair (DexScreener returns priceUsd for the base token)
const DEX_CHAIN = "base";
const PAIR_ALT_WETH = "0xd57f6e7d7ec911ba8defcf93d3682bb76959e950";

// Refresh cadence
const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

// ====== ABIs ======
const farmABI = [
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function claim()",
  "function updatePool()",
  "function pendingRewards(address) view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function users(address) view returns (uint256 amount, uint256 rewardDebt)",
  "function reserveBalance() view returns (uint256)",
  "function dailyDripEstimate() view returns (uint256)"
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

function fmtPct(n) {
  if (n === null || Number.isNaN(n) || !Number.isFinite(n)) return "-";
  return n.toFixed(2) + "%";
}

function fmtUnitsClamped(valueWei, tokenDecimals, displayDecimals = 6) {
  try {
    const s = ethers.formatUnits(valueWei, tokenDecimals);
    if (!s.includes(".")) return s;
    const [a, b] = s.split(".");
    return `${a}.${b.slice(0, displayDecimals)}`;
  } catch {
    return "0";
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

async function updateAltPrice() {
  const now = Date.now();
  if (now - lastPriceTs < 10_000) return; // anti-spam

  try {
    const altPair = await fetchDexScreenerPair(DEX_CHAIN, PAIR_ALT_WETH);
    cachedAltPriceUsd = parseFloat(altPair.priceUsd);
    lastPriceTs = now;
  } catch (e) {
    console.error("Price fetch failed:", e);
    // keep previous cached price if available
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
  rewardDecimals = await usdc.decimals(); // USDC = 6

  safeSetText("status", `Connected: ${user}`);

  await updateAltPrice();
  await refresh();

  setInterval(async () => {
    await updateAltPrice();
    await refresh();
  }, REFRESH_MS);
}

async function refresh() {
  if (!farm || !user) return;

  const [
    u,
    pending,
    totalStaked,
    reserve,
    dripPerDay
  ] = await Promise.all([
    farm.users(user),
    farm.pendingRewards(user),
    farm.totalStaked(),
    farm.reserveBalance(),
    farm.dailyDripEstimate()
  ]);

  safeSetText("staked", fmtUnitsClamped(u.amount, stakeDecimals, 6));
  safeSetText("pending", fmtUnitsClamped(pending, rewardDecimals, 6));
  safeSetText("reserve", fmtUnitsClamped(reserve, rewardDecimals, 6));

  // APR estimate:
  // yearlyRewardsUSD = (dailyDripEstimate * 365) * $1
  // TVL_USD = totalStakedALT * altPriceUsd
  try {
    if (cachedAltPriceUsd && totalStaked > 0n) {
      const tvlAlt = parseFloat(ethers.formatUnits(totalStaked, stakeDecimals));
      const tvlUsd = tvlAlt * cachedAltPriceUsd;

      const dailyUsdc = parseFloat(ethers.formatUnits(dripPerDay, rewardDecimals));
      const yearlyRewardsUsd = dailyUsdc * 365; // USDC ~ $1

      const apr = tvlUsd > 0 ? (yearlyRewardsUsd / tvlUsd) * 100 : null;
      safeSetText("apr", fmtPct(apr));
    } else {
      safeSetText("apr", "-");
    }
  } catch (e) {
    console.error("APR calc failed:", e);
    safeSetText("apr", "-");
  }

  safeSetText("lastUpdate", `Last refresh: ${new Date().toLocaleTimeString()}`);
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

async function updatePoolNow() {
  if (!farm) return;
  try {
    safeSetText("lastUpdate", "Updating pool...");
    const tx = await farm.updatePool();
    await tx.wait();
    await refresh();
    safeSetText("lastUpdate", `Pool updated: ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    console.error("updatePool failed:", e);
    alert("Update Pool failed (see console).");
    await refresh();
  }
}

// ====== UI HOOKS ======
if ($("btnConnect")) $("btnConnect").onclick = connect;
if ($("btnDeposit")) $("btnDeposit").onclick = stake;
if ($("btnWithdraw")) $("btnWithdraw").onclick = withdraw;
if ($("btnClaim")) $("btnClaim").onclick = claim;
if ($("btnUpdate")) $("btnUpdate").onclick = updatePoolNow;
