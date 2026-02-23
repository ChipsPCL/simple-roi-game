// app.js — RewardStakerUSDCDrip (ALT stake -> USDC rewards) — BASE DEPLOYED VERSION FIX
// Farm: 0xC2A0E92F1fc5c0191ef9787c7eB53cbB5D08d6E6
// ALT:  0x90678C02823b21772fa7e91B27EE70490257567B
// USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

// ====== CONFIG ======
const FARM_ADDRESS = "0xC2A0E92F1fc5c0191ef9787c7eB53cbB5D08d6E6";
const ALT = "0x90678C02823b21772fa7e91B27EE70490257567B";  // stake token
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // reward token

// DexScreener (Base) — ALT/WETH (gives ALT priceUsd directly)
const DEX_CHAIN = "base";
const PAIR_ALT_WETH = "0xd57f6e7d7ec911ba8defcf93d3682bb76959e950";

// refresh cadence (UI only — contract accrues on updatePool called by user txs)
const REFRESH_MS = 30 * 1000; // 30 seconds feels much more “alive” than 5 mins

// ====== ABIs ======
// IMPORTANT: These match the VERIFIED contract on BaseScan for your address.
// It uses allocatedRewards + availableRewards(), NOT rewardReserve/reserveBalance().
const farmABI = [
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function claim()",
  "function updatePool()",

  "function pendingRewards(address user) view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function users(address) view returns (uint256 amount, uint256 rewardDebt)",

  // UI helpers on-chain (present in your verified contract)
  "function rewardBalance() view returns (uint256)",
  "function allocatedBalance() view returns (uint256)",
  "function availableRewards() view returns (uint256)",
  "function dailyDripEstimate() view returns (uint256)",
  "function yearlyDripEstimate() view returns (uint256)",
];

const erc20ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

// ====== STATE ======
let provider, signer, user, farm, alt, usdc;
let stakeDecimals = 18;
let rewardDecimals = 6;

// prices
let cachedAltPriceUsd = null;
let lastPriceTs = 0;

// ====== DOM HELPERS ======
const $ = (id) => document.getElementById(id);

// Set text for one id OR multiple common ids (so the UI can stay “minimal”)
function setAnyText(possibleIds, text) {
  const ids = Array.isArray(possibleIds) ? possibleIds : [possibleIds];
  let did = false;
  for (const id of ids) {
    const el = $(id);
    if (el) {
      el.innerText = text;
      did = true;
    }
  }
  return did;
}

function fmtUsd(n) {
  if (n === null || Number.isNaN(n) || !Number.isFinite(n)) return "-";
  return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function fmtPct(n) {
  if (n === null || Number.isNaN(n) || !Number.isFinite(n)) return "-";
  return n.toFixed(2) + "%";
}

// show up to displayDecimals but don’t round down to 0 too early
function fmtUnitsSmart(valueWei, tokenDecimals, displayDecimals = 6) {
  try {
    const s = ethers.formatUnits(valueWei, tokenDecimals); // string
    if (!s.includes(".")) return s;

    const [a, b] = s.split(".");
    const cut = b.slice(0, displayDecimals);

    // If it would display as 0.000000 but actually non-zero, show tiny indicator
    const isZeroDisplay = (a === "0" || a === "-0") && /^0+$/.test(cut);
    if (isZeroDisplay && valueWei > 0n) return "<0.000001";

    return `${a}.${cut}`;
  } catch {
    return "-";
  }
}

// ====== PRICING ======
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

  setAnyText(["priceStatus"], "Updating prices...");

  try {
    const altPair = await fetchDexScreenerPair(DEX_CHAIN, PAIR_ALT_WETH);
    cachedAltPriceUsd = parseFloat(altPair.priceUsd);

    lastPriceTs = now;

    setAnyText(["altPrice"], fmtUsd(cachedAltPriceUsd));
    setAnyText(["priceStatus"], `Prices updated: ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    console.error(e);
    setAnyText(["priceStatus"], "Price update failed (will retry)");
  }
}

// ====== CONNECT / REFRESH ======
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
  alt = new ethers.Contract(ALT, erc20ABI, signer);
  usdc = new ethers.Contract(USDC, erc20ABI, signer);

  stakeDecimals = await alt.decimals();
  rewardDecimals = await usdc.decimals(); // should be 6 for Base USDC

  setAnyText(["status"], `Connected: ${user}`);

  await updatePrices();
  await refresh();

  // steady refresh so numbers move / buttons feel consistent
  setInterval(async () => {
    await updatePrices();
    await refresh();
  }, REFRESH_MS);
}

async function refresh() {
  if (!farm || !user) return;

  // Pull everything in parallel
  const [
    u,
    pending,
    totalStaked,
    walletAlt,
    rewardBal,
    allocatedBal,
    availableBal,
    dripDay,
    dripYear,
  ] = await Promise.all([
    farm.users(user),
    farm.pendingRewards(user),
    farm.totalStaked(),
    alt.balanceOf(user),
    farm.rewardBalance(),
    farm.allocatedBalance(),
    farm.availableRewards(),
    farm.dailyDripEstimate(),
    farm.yearlyDripEstimate(),
  ]);

  // ---- Minimal UI fields (match whatever ids you kept) ----
  // Wallet & deposit
  setAnyText(["stakeBal", "walletBal"], fmtUnitsSmart(walletAlt, stakeDecimals, 6));
  setAnyText(["deposited", "staked"], fmtUnitsSmart(u.amount, stakeDecimals, 6));

  // Pending rewards
  setAnyText(["pending"], fmtUnitsSmart(pending, rewardDecimals, 6));

  // Pool stats (only show what you want in HTML)
  // "Reserve" in your newer wording = availableRewards in this deployed contract
  setAnyText(["reserve", "reserveBalance", "availableRewards"], fmtUnitsSmart(availableBal, rewardDecimals, 6));

  // Optional: if you kept these
  setAnyText(["allocatedBalance"], fmtUnitsSmart(allocatedBal, rewardDecimals, 6));
  setAnyText(["rewardBalance"], fmtUnitsSmart(rewardBal, rewardDecimals, 6));
  setAnyText(["totalStaked"], fmtUnitsSmart(totalStaked, stakeDecimals, 6));
  setAnyText(["emissions", "dailyDrip"], fmtUnitsSmart(dripDay, rewardDecimals, 6));

  // APR + TVL (USD)
  try {
    if (cachedAltPriceUsd && totalStaked > 0n) {
      const totalStakedAlt = parseFloat(ethers.formatUnits(totalStaked, stakeDecimals));
      const tvlUsd = totalStakedAlt * cachedAltPriceUsd;

      // rewards are USDC, treat 1 USDC = $1
      const yearlyRewardsUsdc = parseFloat(ethers.formatUnits(dripYear, rewardDecimals));
      const apr = tvlUsd > 0 ? (yearlyRewardsUsdc / tvlUsd) * 100 : null;

      setAnyText(["apr"], fmtPct(apr));
      setAnyText(["tvlUsd"], fmtUsd(tvlUsd));
    } else {
      setAnyText(["apr"], "-");
      setAnyText(["tvlUsd"], "-");
    }
  } catch (e) {
    console.error(e);
    setAnyText(["apr"], "-");
    setAnyText(["tvlUsd"], "-");
  }
}

// ====== TX HELPERS ======
async function approveIfNeeded(amountWei) {
  const allowance = await alt.allowance(user, FARM_ADDRESS);
  if (allowance >= amountWei) return;

  const tx = await alt.approve(FARM_ADDRESS, amountWei);
  await tx.wait();
}

async function stake() {
  const input = $("depositAmount");
  const val = input ? input.value : "";
  if (!val || Number(val) <= 0) return alert("Enter stake amount");

  const amountWei = ethers.parseUnits(val, stakeDecimals);
  await approveIfNeeded(amountWei);

  const tx = await farm.deposit(amountWei);
  await tx.wait();

  if (input) input.value = "";
  await refresh();
}

async function withdraw() {
  const input = $("withdrawAmount");
  const val = input ? input.value : "";
  if (!val || Number(val) <= 0) return alert("Enter withdraw amount");

  const amountWei = ethers.parseUnits(val, stakeDecimals);

  const tx = await farm.withdraw(amountWei);
  await tx.wait();

  if (input) input.value = "";
  await refresh();
}

async function claim() {
  const tx = await farm.claim();
  await tx.wait();
  await refresh();
}

// Optional: make the UI “feel live” by letting users poke updatePool without depositing.
// Only include if you add a button with id="btnUpdatePool" (otherwise harmless).
async function updatePool() {
  const tx = await farm.updatePool();
  await tx.wait();
  await refresh();
}

// ====== BIND UI HOOKS RELIABLY ======
document.addEventListener("DOMContentLoaded", () => {
  const btnConnect = $("btnConnect");
  const btnDeposit = $("btnDeposit");
  const btnWithdraw = $("btnWithdraw");
  const btnClaim = $("btnClaim");
  const btnUpdatePool = $("btnUpdatePool");

  if (btnConnect) btnConnect.onclick = connect;
  if (btnDeposit) btnDeposit.onclick = stake;
  if (btnWithdraw) btnWithdraw.onclick = withdraw;
  if (btnClaim) btnClaim.onclick = claim;
  if (btnUpdatePool) btnUpdatePool.onclick = updatePool;
});
