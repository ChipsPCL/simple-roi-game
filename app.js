let provider;
let signer;
let userAddress;

const statusBox = document.getElementById("status");
const btnConnect = document.getElementById("btnConnect");
const btnDeposit = document.getElementById("btnDeposit");
const btnClaim = document.getElementById("btnClaim");
const inputDeposit = document.getElementById("inputDeposit");

const depositedEl = document.getElementById("deposited");
const pendingEl = document.getElementById("pending");
const claimedEl = document.getElementById("claimed");

/* =========================
   CONTRACT CONFIG
========================= */

const CONTRACT_ADDRESS = "0xa986e428b39abea31c982fe02b283b845e3005c8";

const ABI = [
  "function userInfo(address) view returns (uint256 deposited, uint256 claimable, uint256 claimed)",
  "function deposit(uint256 amount) nonpayable",
  "function claim() nonpayable",
  "function depositToken() view returns (address)"
];

let contract;
let tokenContract;

/* =========================
   WALLET CONNECT
========================= */

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

        contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

        // Token contract for decimals
        const tokenAddr = await contract.depositToken();
        tokenContract = new ethers.Contract(tokenAddr, ["function decimals() view returns (uint8)"], provider);

        statusBox.innerText = `Connected: ${userAddress}`;

        await refreshUserData();

    } catch (err) {
        console.error(err);
        statusBox.innerText = "Connection failed";
    }
};

/* =========================
   READ USER DATA
========================= */

async function refreshUserData() {
    if (!contract || !userAddress) return;

    try {
        const info = await contract.userInfo(userAddress);
        const decimals = await tokenContract.decimals();

        depositedEl.innerText = ethers.formatUnits(info.deposited, decimals);
        pendingEl.innerText = ethers.formatUnits(info.claimable, decimals);
        claimedEl.innerText = ethers.formatUnits(info.claimed, decimals);

    } catch (err) {
        console.error("Refresh failed:", err);
    }
}

/* =========================
   DEPOSIT BUTTON
========================= */

btnDeposit.onclick = async () => {
    if (!contract || !signer) return;
    const amount = inputDeposit.value;
    if (!amount || Number(amount) <= 0) return alert("Enter deposit amount");

    try {
        const decimals = await tokenContract.decimals();
        const amt = ethers.parseUnits(amount, decimals);
        const tx = await contract.deposit(amt);
        await tx.wait();
        await refreshUserData();
    } catch (err) {
        console.error("Deposit failed:", err);
    }
};

/* =========================
   CLAIM BUTTON
========================= */

btnClaim.onclick = async () => {
    if (!contract || !signer) return;

    try {
        const tx = await contract.claim();
        await tx.wait();
        await refreshUserData();
    } catch (err) {
        console.error("Claim failed:", err);
    }
};
