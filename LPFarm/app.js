// ====== CONFIG ======
const FARM_ADDRESS = "0x5AE7DF6C8923F5a3AADE383cDb4742644e64544D";

// Stake token is the V2 LP token (BaseSwap ALT/WETH)
const LP_TOKEN = "0xD57f6e7D7eC911bA8deFCf93d3682BB76959e950";

// Reward token (testing with ALT)
const ALT  = "0x90678C02823b21772fa7e91B27EE70490257567B";

// DexScreener (Base)
const DEX_CHAIN = "base";
const PAIR_ALT_WETH = "0xd57f6e7d7ec911ba8defcf93d3682bb76959e950";

// UI label override (so we never show "BSWAP-LP")
const STAKE_LABEL = "Altitude/WETH LP";

// LP pricing
const LIQUIDITY_DIVISOR = 1;

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
  "function totalSupply() view returns (uint256)"
];

// ====== STATE ======
let provider, signer, user, farm, lp, alt;

let stakeDecimals = 18;   // LP decimals (usually 18)
let rewardDecimals = 18;  // ALT decimals (18)

// Cache:
// - poolLiquidityUsd is DEX pool liquidity
// - altPriceUsd is ALT spot price in USD
let cachedPoolLiquidityUsd = null;
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
 * - Pool liquidity USD from pair.liquidity.usd (DEX pool TVL, NOT farm TVL)
 * - ALT price USD (best-effort)
 */
async function updatePrices() {
  const now = Date.now();
  if (now - lastPriceTs < 10_000) return;

  const priceEl = $("priceStatus");
  if (priceEl) priceEl.innerText = "Updating prices...";

  try {
    const pair = await fetchDexScreenerPair(DEX_CHAIN, PAIR_ALT_WETH);

    cachedPoolLiquidityUsd = pair?.liquidity?.usd ? parseFloat(pair.liquidity.usd) : null;

    const baseAddr = pair?.baseToken?.address?.toLowerCase?.() || "";
    const quoteAddr = pair?.quoteToken?.address?.toLowerCase?.() || "";

    if (baseAddr === ALT.toLowerCase()) {
      cachedAltPriceUsd = pair?.priceUsd ? parseFloat(pair.priceUsd) : null;
    } else if (quoteAddr === ALT.toLowerCase()) {
      // quoteToken.priceUsd isn't always present; fallback to pair.priceUsd
      const qUsd = pair?.quoteToken?.priceUsd ? parseFloat(pair.quoteToken.priceUsd) : null;
      cachedAltPriceUsd = qUsd ?? (pair?.priceUsd ? parseFloat(pair.priceUsd) : null);
    } else {
      cachedAltPriceUsd = pair?.priceUsd ? parseFloat(pair.priceUsd) : null;
    }

    lastPriceTs = now;

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

  stakeDecimals = await lp.decimals();
  rewardDecimals = await alt.decimals();

  $("status").innerText = `Connected: ${user}`;

  // Optional: if you have an element for stake label, set it
  if ($("stakeLabel")) $("stakeLabel").innerText = STAKE_LABEL;

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
  const [u, pending, totalStakedRaw, rps, lpBalRaw, lpSupplyRaw] = await Promise.all([
    farm.users(user),
    farm.pendingRewards(user),
    farm.totalStaked(),
    farm.rewardPerSecond(),
    lp.balanceOf(user),
    lp.totalSupply(),
  ]);

  const lpBal = parseFloat(ethers.formatUnits(lpBalRaw, stakeDecimals));
  const yourStakedLp = parseFloat(ethers.formatUnits(u.amount, stakeDecimals));
  const totalStakedLp = parseFloat(ethers.formatUnits(totalStakedRaw, stakeDecimals));
  const lpSupply = parseFloat(ethers.formatUnits(lpSupplyRaw, stakeDecimals));

  // UI: balances
  if ($("stakeBal")) $("stakeBal").innerText = `${fmtNum(lpBal)} ${STAKE_LABEL}`;
  if ($("staked")) $("staked").innerText = `${fmtNum(yourStakedLp)} ${STAKE_LABEL}`;
  if ($("pending")) $("pending").innerText = `${fmtNum(parseFloat(ethers.formatUnits(pending, rewardDecimals)))} ALT`;
  if ($("totalStaked")) $("totalStaked").innerText = `${fmtNum(totalStakedLp)} ${STAKE_LABEL}`;

  // Emissions/day (HTML already shows "ALT/day")
const perDay = rps * SECONDS_PER_DAY;
if ($("emissions")) {
  $("emissions").innerText = fmtNum(
    parseFloat(ethers.formatUnits(perDay, rewardDecimals))
  );
}
  // ---------- LP price ----------
  // LP price = (DEX pool liquidity USD / divisor) / LP totalSupply
  let lpPriceUsd = null;
  if (cachedPoolLiquidityUsd && lpSupply > 0) {
    lpPriceUsd = (cachedPoolLiquidityUsd / LIQUIDITY_DIVISOR) / lpSupply;
  }
  if ($("lpPriceUsd")) $("lpPriceUsd").innerText = fmtUsd(lpPriceUsd);

  // ---------- FARM TVL ----------
  // Farm TVL = farm.totalStaked() (LP tokens) * LP price USD
  let farmTvlUsd = null;
  if (lpPriceUsd !== null) {
    farmTvlUsd = totalStakedLp * lpPriceUsd;
  }

  // Show 0 when empty (instead of "-")
  if ($("tvlUsd")) {
    if (farmTvlUsd === null) $("tvlUsd").innerText = "-";
    else $("tvlUsd").innerText = fmtUsd(farmTvlUsd);
  }

  // Optional: user's USD value
  let yourValueUsd = null;
  if (lpPriceUsd !== null) {
    yourValueUsd = yourStakedLp * lpPriceUsd;
  }
  if ($("yourValueUsd")) $("yourValueUsd").innerText = fmtUsd(yourValueUsd);

  // ---------- APR ----------
  // APR = yearlyRewardsUsd / farmTVLUsd
  try {
    if (cachedAltPriceUsd && farmTvlUsd && farmTvlUsd > 0 && totalStakedRaw > 0n) {
      const yearlyRewardWei = rps * SECONDS_PER_YEAR;
      const yearlyRewardTokens = parseFloat(ethers.formatUnits(yearlyRewardWei, rewardDecimals));
      const yearlyRewardsUsd = yearlyRewardTokens * cachedAltPriceUsd;

      const apr = (yearlyRewardsUsd / farmTvlUsd) * 100;
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
