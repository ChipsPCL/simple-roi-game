// ====== CONFIG ======
const FARM_ADDRESS = "0xEDf944C6c84255aD529AD366975D556F4e3B0c7f";

const WETH = "0x4200000000000000000000000000000000000006";
const ALT  = "0x90678C02823b21772fa7e91B27EE70490257567B";

// DexScreener pairs you provided (Base)
const DEX_CHAIN = "base";
const PAIR_WETH_USDC = "0x6c561b446416e1a00e8e93e221854d6ea4171372";
const PAIR_ALT_WETH  = "0xd57f6e7d7ec911ba8defcf93d3682bb76959e950";

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
  "function decimals() view returns (uint8)"
];

// ====== STATE ======
let provider, signer, user, farm, weth, alt;
let stakeDecimals = 18;
let rewardDecimals = 18;

let cachedWethPriceUsd = null;
let cachedAltPriceUsd = null;
let lastPriceTs = 0;

const ACC = 1e18;

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
    const [wethPair, altPair] = await Promise.all([
      fetchDexScreenerPair(DEX_CHAIN, PAIR_WETH_USDC),
      fetchDexScreenerPair(DEX_CHAIN, PAIR_ALT_WETH),
    ]);

    // pair.priceUsd is the USD price of the pair's base token
    cachedWethPriceUsd = parseFloat(wethPair.priceUsd);
    cachedAltPriceUsd  = parseFloat(altPair.priceUsd);

    lastPriceTs = now;

    $("wethPrice").innerText = fmtUsd(cachedWethPriceUsd);
    $("altPrice").innerText  = fmtUsd(cachedAltPriceUsd);

    if (priceEl) priceEl.innerText = `Prices updated: ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    console.error(e);
    if (priceEl) priceEl.innerText = `Price update failed (will retry next refresh)`;
    // keep old cached prices if available
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
  weth = new ethers.Contract(WETH, erc20ABI, signer);
  alt  = new ethers.Contract(ALT, erc20ABI, signer);

  stakeDecimals = await weth.decimals();
  rewardDecimals = await alt.decimals();

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

  const [u, pending, total, rps, wethBal] = await Promise.all([
    farm.users(user),
    farm.pendingRewards(user),
    farm.totalStaked(),
    farm.rewardPerSecond(),
    weth.balanceOf(user),
  ]);

  $("stakeBal").innerText = ethers.formatUnits(wethBal, stakeDecimals);
  $("staked").innerText   = ethers.formatUnits(u.amount, stakeDecimals);
  $("pending").innerText  = ethers.formatUnits(pending, rewardDecimals);
  $("totalStaked").innerText = ethers.formatUnits(total, stakeDecimals);

  // Emissions/day
  const perDay = rps * SECONDS_PER_DAY;
  $("emissions").innerText = ethers.formatUnits(perDay, rewardDecimals);

  // APR + TVL (USD) using cached prices
  // APR = (yearlyRewardsUSD / TVL_USD) * 100
  try {
    if (cachedWethPriceUsd && cachedAltPriceUsd && total > 0n) {
      const yearlyReward = rps * SECONDS_PER_YEAR;

      const yearlyRewardTokens = parseFloat(ethers.formatUnits(yearlyReward, rewardDecimals));
      const totalStakedTokens  = parseFloat(ethers.formatUnits(total, stakeDecimals));

      // stake token is WETH in this test UI, price from WETH/USDC
      const tvlUsd = totalStakedTokens * cachedWethPriceUsd;
      const yearlyRewardsUsd = yearlyRewardTokens * cachedAltPriceUsd;

      const apr = tvlUsd > 0 ? (yearlyRewardsUsd / tvlUsd) * 100 : null;

      $("apr").innerText = fmtPct(apr);
      $("tvlUsd").innerText = fmtUsd(tvlUsd);
    } else {
      $("apr").innerText = "-";
      $("tvlUsd").innerText = "-";
    }
  } catch (e) {
    console.error(e);
    $("apr").innerText = "-";
    $("tvlUsd").innerText = "-";
  }
}

async function approveIfNeeded(amountWei) {
  const allowance = await weth.allowance(user, FARM_ADDRESS);
  if (allowance >= amountWei) return;

  const tx = await weth.approve(FARM_ADDRESS, amountWei);
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
