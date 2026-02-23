// app.js — RewardStakerUSDCDrip (ALT stake -> USDC rewards) — DEPLOYED VERSION (BaseScan)

// ====== CONFIG ======
const FARM_ADDRESS = "0xC2A0E92F1fc5c0191ef9787c7eB53cbB5D08d6E6";

const ALT  = "0x90678C02823b21772fa7e91B27EE70490257567B"; // stake token
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // reward token

// DexScreener (Base) — ALT/WETH pair (gives priceUsd directly)
const DEX_CHAIN = "base";
const PAIR_ALT_WETH = "0xd57f6e7d7ec911ba8defcf93d3682bb76959e950";

// refresh cadence
const REFRESH_MS = 60 * 1000; // 1 minute feels better UX than 5m for drip displays

// ====== ABIs ======
// RewardStakerUSDCDrip ABI (ONLY functions that exist in your deployed contract)
const farmABI = [
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function claim()",
  "function updatePool()",
  "function pendingRewards(address userAddr) view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function users(address) view returns (uint256 amount, uint256 rewardDebt)",

  // helpers from deployed contract
  "function rewardBalance() view returns (uint256)",
  "function allocatedBalance() view returns (uint256)",
  "function availableRewards() view returns (uint256)",
  "function dailyDripEstimate() view returns (uint256)",
  "function yearlyDripEstimate() view returns (uint256)"
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

// Format on-chain units, clamp display decimals for nicer UI
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

function setButtonsEnabled(enabled) {
  const ids = ["btnDeposit", "btnWithdraw", "btnClaim", "btnUpdatePool"];
  for (const id of ids) {
    const el = $(id);
    if (el) el.disabled = !enabled;
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
    cachedAltPriceUsd = parseFloat(altPair.priceUsd);

    lastPriceTs = now;

    safeSetText("altPrice", fmtUsd(cachedAltPriceUsd));
    safeSetText("priceStatus", `Prices updated: ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    console.error(e);
    safeSetText("priceStatus", "Price update failed (will retry next refresh)");
  }
}

async function connect() {
  try {
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
    setButtonsEnabled(true);

    await updatePrices();
    await refresh();

    setInterval(async () => {
      await updatePrices();
      await refresh();
    }, REFRESH_MS);
  } catch (e) {
    console.error(e);
    alert("Connect failed. Check console.");
  }
}

async function refresh() {
  if (!farm || !user) return;

  // Pull everything we show in UI
  const [
    u,
    pending,
    total,
    altBal,
    rewardBal,
    allocatedBal,
    availableBal,
    dripPerDay,
    dripPerYear
  ] = await Promise.all([
    farm.users(user),
    farm.pendingRewards(user),
    farm.totalStaked(),
    alt.balanceOf(user),
    farm.rewardBalance(),
    farm.allocatedBalance(),
    farm.availableRewards(),
    farm.dailyDripEstimate(),
    farm.yearlyDripEstimate()
  ]);

  // Wallet + Staking
  safeSetText("stakeBal", fmtUnitsClamped(altBal, stakeDecimals, 6));
  safeSetText("staked", fmtUnitsClamped(u.amount, stakeDecimals, 6));
  safeSetText("pending", fmtUnitsClamped(pending, rewardDecimals, 6));
  safeSetText("totalStaked", fmtUnitsClamped(total, stakeDecimals, 6));

  // Rewards accounting (THIS is the key part for your contract)
  safeSetText("rewardBalance", fmtUnitsClamped(rewardBal, rewardDecimals, 6));     // total USDC held
  safeSetText("allocatedBalance", fmtUnitsClamped(allocatedBal, rewardDecimals, 6)); // allocated but unpaid
  safeSetText("reserveBalance", fmtUnitsClamped(availableBal, rewardDecimals, 6)); // available for NEW drip (bal - allocated)

  // Emissions/day (USDC)
  safeSetText("emissions", fmtUnitsClamped(dripPerDay, rewardDecimals, 6));

  // APR + TVL (USD)
  try {
    if (cachedAltPriceUsd && total > 0n) {
      const totalStakedAlt = parseFloat(ethers.formatUnits(total, stakeDecimals));
      const tvlUsd = totalStakedAlt * cachedAltPriceUsd;

      // Rewards are USDC, assume $1 per USDC
      const yearlyRewardsUsdc = parseFloat(ethers.formatUnits(dripPerYear, rewardDecimals));
      const apr = tvlUsd > 0 ? (yearlyRewardsUsdc / tvlUsd) * 100 : null;

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

// Optional: let anyone trigger pool update (requires gas)
async function updatePoolTx() {
  const tx = await farm.updatePool();
  await tx.wait();
  await refresh();
}

// ====== UI HOOKS ======
document.addEventListener("DOMContentLoaded", () => {
  setButtonsEnabled(false);

  if ($("btnConnect")) $("btnConnect").onclick = connect;
  if ($("btnDeposit")) $("btnDeposit").onclick = stake;
  if ($("btnWithdraw")) $("btnWithdraw").onclick = withdraw;
  if ($("btnClaim")) $("btnClaim").onclick = claim;

  // If you add a button with id="btnUpdatePool" in HTML, it will work.
  if ($("btnUpdatePool")) $("btnUpdatePool").onclick = updatePoolTx;
});
