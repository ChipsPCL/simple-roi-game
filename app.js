let provider;
let signer;
let userAddress;
let contract;

// =========================
// CONTRACT CONFIG
// =========================
const CONTRACT_ADDRESS = "0xa986e428b39abea31c982fe02b283b845e3005c8";

// Minimal ABI for your contract (full ABI would also work)
const ABI = [
  "function userInfo(address) view returns (uint256 deposited, uint256 claimable, uint256 claimed)",
  "function deposit(uint256 amount) nonpayable",
  "function claim() nonpayable"
];

// =========================
// ELEMENTS
// =========================
const statusBox = document.getElementById("status");
const btnConnect = document.getElementById("btnConnect");
const btnDeposit = document.getElementById("btnDeposit");
const btnClaim = document.getElementById("btnClaim");
const inputDeposit = document.getElementById("inputDeposit");

const depositedEl = document.getElementById("deposited");
const pendingEl = document.getElementById("pending");
const claimedEl = document.getElementById("claimed");

// =========================
// WALLET CONNECT
// =========================
btnConnect.onclick = async () => {
  if (!window.ethereum) {
    statusBox.innerText = "No wallet detected";
    return;
  }

  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);

    signer = await provider.getSigner();
    userAddress = await signer.getAddress();

    contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

    statusBox.innerText = `Connected: ${userAddress}`;
    console.log("Connected:", userAddress);

    await refreshUserData();

  } catch (err) {
    console.error(err);
    statusBox.innerText = "Connection failed";
  }
};

// =========================
// REFRESH USER DATA
// =========================
async function refreshUserData() {
  if (!contract || !userAddress) return;

  try {
    const info = await contract.userInfo(userAddress);
    depositedEl.innerText = ethers.formatUnits(info.deposited, 18);
    pendingEl.innerText = ethers.formatUnits(info.claimable, 18);
    claimedEl.innerText = ethers.formatUnits(info.claimed, 18);
  } catch (err) {
    console.error("Refresh failed:", err);
  }
}

// =========================
// DEPOSIT
// =========================
btnDeposit.onclick = async () => {
  if (!signer || !contract) return;

  const amountStr = inputDeposit.value;
  if (!amountStr || isNaN(amountStr) || Number(amountStr) <= 0) {
    alert("Enter a valid amount");
    return;
  }

  const amount = ethers.parseUnits(amountStr, 18); // assuming 18 decimals

  try {
    const tx = await contract.connect(signer).deposit(amount);
    statusBox.innerText = "Deposit pending...";
    await tx.wait();
    statusBox.innerText = "Deposit successful!";
    await refreshUserData();
  } catch (err) {
    console.error("Deposit failed:", err);
    statusBox.innerText = "Deposit failed";
  }
};

// =========================
// CLAIM
// =========================
btnClaim.onclick = async () => {
  if (!signer || !contract) return;

  try {
    const tx = await contract.connect(signer).claim();
    statusBox.innerText = "Claim pending...";
    await tx.wait();
    statusBox.innerText = "Claim successful!";
    await refreshUserData();
  } catch (err) {
    console.error("Claim failed:", err);
    statusBox.innerText = "Claim failed";
  }
};
