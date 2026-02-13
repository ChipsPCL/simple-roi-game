// ====== CONFIG (edit only FARM_ADDRESS) ======
const FARM_ADDRESS = "0xEDf944C6c84255aD529AD366975D556F4e3B0c7f";

const WETH = "0x4200000000000000000000000000000000000006";
const ALT  = "0x90678C02823b21772fa7e91B27EE70490257567B";

// ====== ABIs ======
const farmABI = [
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function claim()",
  "function emergencyWithdraw()",
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

const $ = (id) => document.getElementById(id);

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
  alt  = new ethers.Contract(ALT,  erc20ABI, signer);

  stakeDecimals = await weth.decimals();
  rewardDecimals = await alt.decimals();

  const net = await provider.getNetwork();
  $("status").innerText = `Connected: ${user}`;
  $("net").innerText = `Network: ${net.name} (${net.chainId})`;

  await refresh();
  setInterval(refresh, 10000);
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
  $("staked").innerText = ethers.formatUnits(u.amount, stakeDecimals);
  $("pending").innerText = ethers.formatUnits(pending, rewardDecimals);
  $("totalStaked").innerText = ethers.formatUnits(total, stakeDecimals);

  const perDay = rps * 86400n;
  $("emissions").innerText = ethers.formatUnits(perDay, rewardDecimals);
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

async function emergency() {
  const ok = confirm("Emergency withdraw forfeits rewards (still charges 3% fee). Continue?");
  if (!ok) return;

  const tx = await farm.emergencyWithdraw();
  await tx.wait();

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
