// ====== CONFIG ======
const FARM_ADDRESS = "0x7B3A9BDC0Fad5f92e6a7f08486659061E2A97254";

// Tokens (Base)
const CB_BTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"; // cbBTC
const ALT    = "0x90678C02823b21772fa7e91B27EE70490257567B"; // Altitude

// DexScreener pairs (Base)
const DEX_CHAIN = "base";
const PAIR_CBBTC_USDC = "0x4e962BB3889Bf030368F56810A9c96B83CB3E778"; // cbBTC/USDC
const PAIR_ALT_WETH   = "0xd57f6e7d7ec911ba8defcf93d3682bb76959e950"; // ALT/WETH (price source)

// Refresh cadence
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
  "function decimals() view returns (uint8)"
];

// ====== STATE ======
let provider, signer, user, farm, cbbtc, alt;
let stakeDecimals = 8;
let rewardDecimals = 18;

let cachedStakePriceUsd = null; // cbBTC/USD
let cachedAltPriceUsd = null;   // ALT/USD
let lastPriceTs = 0;

const $ = (id) => document.getElementById(id);

function fmtUsd(n) {
  if (n === null || Number.isNaN(n)) return "-";
  return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function fmtPct(n) {
  if (n === null || Number.isNaN(n) || !Number.isFinite(n)) return "-";
  return n.toFixed(2) + "%";
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
  // prevent spamming if called repeatedly
  const now = Date.now();
  if (now - lastPriceTs < 10_000) return;

  const priceEl = $("priceStatus");
  if (priceEl) priceEl.innerText = "Updating prices...";

  try {
    const [stakePair, altPair] = await Promise.all([
      fetchDexScreenerPair(DEX_CHAIN, PAIR_CBBTC_USDC),
      fetchDexScreenerPair(DEX_CHAIN, PAIR_ALT_WETH),
    ]);

    // USD price of the pair's base token (DexScreener)
    cachedStakePriceUsd = parseFloat(stakePair.priceUsd); // cbBTC USD
    cachedAltPriceUsd   = parseFloat(altPair.priceUsd);   // ALT USD

    lastPriceTs = now;

    // NOTE: keeping existing element ids for convenience
    if ($("wethPrice")) $("wethPrice").innerText = fmtUsd(cachedStakePriceUsd);
    if ($("altPrice"))  $("altPrice").innerText  = fmtUsd(cachedAltPriceUsd);

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

  farm  = new ethers.Contract(FARM_ADDRESS, farmABI, signer);
  cbbtc = new ethers.Contract(CB_BTC, erc20ABI, signer);
  alt   = new ethers.Contract(ALT, erc20ABI, signer);

  stakeDecimals  = await cbbtc.decimals(); // should be 8
  rewardDecimals = await alt.decimals();   // likely 18

  $("status").innerText = `Connected: ${user}`;

  await updatePrices();
  await refresh();

  // refresh on a calm cadence (5 min)
  setInterval(async () => {
    await updatePrices();
    await refresh();
  }, REFRESH_MS);
}

async function refresh() {
  if (!farm || !user) return;

  const [u, pending, total, rps, stakeBal] = await Promise.all([
    farm.users(user),
    farm.pendingRewards(user),
    farm.totalStaked(),
    farm.rewardPerSecond(),
    cbbtc.balanceOf(user),
  ]);

  if ($("stakeBal")) $("stakeBal").innerText = ethers.formatUnits(stakeBal, stakeDecimals);
  if ($("staked"))   $("staked").innerText   = ethers.formatUnits(u.amount, stakeDecimals);
  if ($("pending"))  $("pending").innerText  = ethers.formatUnits(pending, rewardDecimals);
  if ($("totalStaked")) $("totalStaked").innerText = ethers.formatUnits(total, stakeDecimals);

  // Emissions/day
  const perDay = rps * SECONDS_PER_DAY;
  if ($("emissions")) $("emissions").innerText = ethers.formatUnits(perDay, rewardDecimals);

  // APR + TVL (USD)
  try {
    if (cachedStakePriceUsd && cachedAltPriceUsd && total > 0n) {
      const yearlyReward = rps * SECONDS_PER_YEAR;

      const yearlyRewardTokens = parseFloat(ethers.formatUnits(yearlyReward, rewardDecimals));
      const totalStakedTokens  = parseFloat(ethers.formatUnits(total, stakeDecimals));

      const tvlUsd = totalStakedTokens * cachedStakePriceUsd;       // cbBTC TVL
      const yearlyRewardsUsd = yearlyRewardTokens * cachedAltPriceUsd;

      const apr = tvlUsd > 0 ? (yearlyRewardsUsd / tvlUsd) * 100 : null;

      if ($("apr")) $("apr").innerText = fmtPct(apr);
      if ($("tvlUsd")) $("tvlUsd").innerText = fmtUsd(tvlUsd);
    } else {
      if ($("apr")) $("apr").innerText = "-";
      if ($("tvlUsd")) $("tvlUsd").innerText = "-";
    }
  } catch (e) {
    console.error(e);
    if ($("apr")) $("apr").innerText = "-";
    if ($("tvlUsd")) $("tvlUsd").innerText = "-";
  }
}

async function approveIfNeeded(amountWei) {
  const allowance = await cbbtc.allowance(user, FARM_ADDRESS);
  if (allowance >= amountWei) return;

  const tx = await cbbtc.approve(FARM_ADDRESS, amountWei);
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

