// ====== CONFIG ======
const FARM_ADDRESS = "0x5AE7DF6C8923F5a3AADE383cDb4742644e64544D";

// Stake token is the V2 LP token (BaseSwap ALT/WETH)
const LP_TOKEN = "0xD57f6e7D7eC911bA8deFCf93d3682BB76959e950";

// Reward token (testing with ALT)
const ALT  = "0x90678C02823b21772fa7e91B27EE70490257567B";

// DexScreener (Base)
const DEX_CHAIN = "base";
// We'll use the LP pair page for:
// - TVL via liquidity.usd
// - ALT price via priceUsd (base token price) depending on which token is base in DexScreener
const PAIR_ALT_WETH = "0xd57f6e7d7ec911ba8defcf93d3682bb76959e950";

// refresh cadence
const REFRESH_MS = 5 * 60 * 1000; // 5 minutes
const SECONDS_PER_YEAR = 31_536_000n;
const SECONDS_PER_DAY  = 86_400n;

// ====== ABIs ======
const farmABI = [
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function claim()",
  "function pendingRewards(address) view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function rewardPerSecond() view returns (uint256)",
  "function users(address) view returns (uint256 amount, uint256 rewardDebt)"
];

const erc20ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function symbol() view returns (string)"
];

// ====== STATE ======
let provider, signer, user, farm, lp, alt;

let stakeDecimals = 18;   // LP decimals (usually 18)
let rewardDecimals = 18;  // ALT decimals (18)
let lpSymbol = "LP";

let cachedTvlUsd = null;
let cachedAltPriceUsd = null;
let lastPriceTs = 0;

const $ = (id) => document.getElementById(id);

function fmtUsd(n) {
  if (n === null || Number.isNaN(n) || !Number.isFinite(n)) return "-";
  return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function fmtPct(n) {
  if (n === null || Number.isNaN(n) || !Number.isFinite(n)) return "-";
  return n.toFixed(2) + "%";
}

function fmtNum(n, maxDp = 6) {
  if (n === null || Number.isNaN(n) || !Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: maxDp });
}

async function fetchDexScreenerPair(chain, pairAddress) {
  const url = `https://api.dexscreener.com/latest/dex/pairs/${chain}/${pairAddress}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
  const data = await res.json();
  if (!data || !data.pair) throw new Error("DexScreener: missing pair");
  return data.pair;
}

/**
 * Gets:
 * - TVL USD from pair.liquidity.usd
 * - ALT price USD:
 *    DexScreener's pair.priceUsd is the USD price of the *base token* on that pair.
 *    We detect whether base token is ALT; if not, use quote token price if available.
 */
async function updatePrices() {
  const now = Date.now();
  if (now - lastPriceTs < 10_000) return;

  const priceEl = $("priceStatus");
  if (priceEl) priceEl.innerText = "Updating prices...";

  try {
    const pair = await fetchDexScreenerPair(DEX_CHAIN, PAIR_ALT_WETH);

    // TVL (DexScreener liquidity.usd)
    cachedTvlUsd = pair?.liquidity?.usd ? parseFloat(pair.liquidity.usd) : null;

    // Figure out ALT price USD
    // pair.baseToken / pair.quoteToken include addresses
    const baseAddr = pair?.baseToken?.address?.toLowerCase?.() || "";
    const quoteAddr = pair?.quoteToken?.address?.toLowerCase?.() || "";

    // pair.priceUsd = USD price of base token
    // pair.priceNative = base token price in "native" (often ETH/WETH depending on chain)
    // Sometimes quote token also has a derived USD; if not, we can approximate using pair.priceUsd and the price ratio,
    // but we'll keep it simple and robust for this test:
    if (baseAddr === ALT.toLowerCase()) {
      cachedAltPriceUsd = pair?.priceUsd ? parseFloat(pair.priceUsd) : null;
    } else if (quoteAddr === ALT.toLowerCase()) {
      // Some DexScreener responses include quoteToken.priceUsd in newer feeds; not guaranteed.
      // Try it, else fall back to pair.priceUsd if it's still "about ALT" (not ideal but usually OK for ALT/WETH pairs).
      const qUsd = pair?.quoteToken?.priceUsd ? parseFloat(pair.quoteToken.priceUsd) : null;
      cachedAltPriceUsd = qUsd ?? (pair?.priceUsd ? parseFloat(pair.priceUsd) : null);
    } else {
      // ALT not detected in tokens (shouldn't happen with correct pair)
      cachedAltPriceUsd = pair?.priceUsd ? parseFloat(pair.priceUsd) : null;
    }

    lastPriceTs = now;

    // Update UI (IDs kept from your existing layout)
    if ($("tvlUsd")) $("tvlUsd").innerText = fmtUsd(cachedTvlUsd);
    if ($("altPrice")) $("altPrice").innerText = fmtUsd(cachedAltPriceUsd);

    if (priceEl) priceEl.innerText = `Prices updated: ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    console.error(e);
    if (priceEl) priceEl.innerText = `Price update failed (will retry next refresh)`;
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
  lp   = new ethers.Contract(LP_TOKEN, erc20ABI, signer);
  alt  = new ethers.Contract(ALT, erc20ABI, signer);

  // decimals
  stakeDecimals = await lp.decimals();
  rewardDecimals = await alt.decimals();

  // nice label if available
  try { lpSymbol = await lp.symbol(); } catch { lpSymbol = "LP"; }

  $("status").innerText = `Connected: ${user}`;

  await updatePrices();
  await refresh();

  setInterval(async () => {
    await updatePrices();
    await refresh();
  }, REFRESH_MS);
}

async function refresh() {
  if (!farm || !user) return;

  // Read farm + wallet balances
  const [u, pending, totalStaked, rps, lpBal, lpSupply] = await Promise.all([
    farm.users(user),
    farm.pendingRewards(user),
    farm.totalStaked(),
    farm.rewardPerSecond(),
    lp.balanceOf(user),
    lp.totalSupply(),
  ]);

  // UI: balances
  if ($("stakeBal")) $("stakeBal").innerText = `${fmtNum(parseFloat(ethers.formatUnits(lpBal, stakeDecimals)))} ${lpSymbol}`;
  if ($("staked")) $("staked").innerText = `${fmtNum(parseFloat(ethers.formatUnits(u.amount, stakeDecimals)))} ${lpSymbol}`;
  if ($("pending")) $("pending").innerText = `${fmtNum(parseFloat(ethers.formatUnits(pending, rewardDecimals)))} ALT`;
  if ($("totalStaked")) $("totalStaked").innerText = `${fmtNum(parseFloat(ethers.formatUnits(totalStaked, stakeDecimals)))} ${lpSymbol}`;

  // Emissions/day
  const perDay = rps * SECONDS_PER_DAY;
  if ($("emissions")) $("emissions").innerText = `${fmtNum(parseFloat(ethers.formatUnits(perDay, rewardDecimals)))} ALT/day`;

  // LP Price + Your LP USD value
  // lpPriceUsd = tvlUsd / totalSupplyTokens
  // tvl for *pool*; totalSupply is pool LP supply; that gives $/LP
  let lpPriceUsd = null;
  let yourLpUsd = null;

  try {
    const supplyTokens = parseFloat(ethers.formatUnits(lpSupply, stakeDecimals));
    if (cachedTvlUsd && supplyTokens > 0) {
      lpPriceUsd = cachedTvlUsd / supplyTokens;

      const yourLpTokens = parseFloat(ethers.formatUnits(u.amount, stakeDecimals));
      yourLpUsd = yourLpTokens * lpPriceUsd;
    }
  } catch (e) {
    console.error(e);
  }

  // If you add these IDs in HTML, they’ll display (optional but recommended)
  if ($("lpPriceUsd")) $("lpPriceUsd").innerText = fmtUsd(lpPriceUsd);
  if ($("yourValueUsd")) $("yourValueUsd").innerText = fmtUsd(yourLpUsd);

  // APR estimate
  // APR = (yearlyRewardsUSD / TVL_USD) * 100
  try {
    if (cachedTvlUsd && cachedAltPriceUsd && totalStaked > 0n) {
      const yearlyRewardWei = rps * SECONDS_PER_YEAR;
      const yearlyRewardTokens = parseFloat(ethers.formatUnits(yearlyRewardWei, rewardDecimals));
      const yearlyRewardsUsd = yearlyRewardTokens * cachedAltPriceUsd;

      const apr = cachedTvlUsd > 0 ? (yearlyRewardsUsd / cachedTvlUsd) * 100 : null;
      if ($("apr")) $("apr").innerText = fmtPct(apr);
    } else {
      if ($("apr")) $("apr").innerText = "-";
    }
  } catch (e) {
    console.error(e);
    if ($("apr")) $("apr").innerText = "-";
  }
}

async function approveIfNeeded(amountWei) {
  const allowance = await lp.allowance(user, FARM_ADDRESS);
  if (allowance >= amountWei) return;

  const tx = await lp.approve(FARM_ADDRESS, amountWei);
  await tx.wait();
}

async function stake() {
  const val = $("depositAmount").value;
  if (!val || Number(val) <= 0) return alert("Enter stake amount");

  const amountWei = ethers.parseUnits(val, stakeDecimals);
  await approveIfNeeded(amountWei);

  const tx = await farm.deposit(amountWei);
  await tx.wait();

  $("depositAmount").value = "";
  await refresh();
}

async function withdraw() {
  const val = $("withdrawAmount").value;
  if (!val || Number(val) <= 0) return alert("Enter withdraw amount");

  const amountWei = ethers.parseUnits(val, stakeDecimals);

  const tx = await farm.withdraw(amountWei);
  await tx.wait();

  $("withdrawAmount").value = "";
  await refresh();
}

async function claim() {
  const tx = await farm.claim();
  await tx.wait();
  await refresh();
}

// ====== UI HOOKS ======
$("btnConnect").onclick = connect;
$("btnDeposit").onclick = stake;
$("btnWithdraw").onclick = withdraw;
$("btnClaim").onclick = claim;
