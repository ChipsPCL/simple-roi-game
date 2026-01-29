let provider;
let signer;
let userAddress;

const statusBox = document.getElementById("status");
const btnConnect = document.getElementById("btnConnect");
const btnDeposit = document.getElementById("btnDeposit");
const btnClaim = document.getElementById("btnClaim");
const inputDeposit = document.getElementById("inputDeposit");

/* =========================
   CONTRACT CONFIG
========================= */

const CONTRACT_ADDRESS = "0xa986e428b39abea31c982fe02b283b845e3005c8";

const ABI = [
    "function userInfo(address) view returns (uint256 deposited, uint256 claimable, uint256 claimed)",
    "function deposit(uint256 amount)",
    "function claim()"
];

let contract;

/* =========================
   NETWORK CONFIG
========================= */

const BASE_CHAIN_ID = 8453; // Base mainnet

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

        const network = await provider.getNetwork();
        if (network.chainId !== BASE_CHAIN_ID) {
            statusBox.innerText = `Wrong network! Please switch to Base (chainId ${BASE_CHAIN_ID})`;
            btnDeposit.disabled = true;
            btnClaim.disabled = true;
            return;
        }

        statusBox.innerText = `Connected: ${userAddress}`;
        btnDeposit.disabled = false;
        btnClaim.disabled = false;

        await refreshUserData();

    } catch (err) {
        console.error(err);
        statusBox.innerText = "Connection failed";
    }
};

/* =========================
   REFRESH USER DATA
========================= */

async function refreshUserData() {
    if (!contract || !userAddress) return;

    try {
        const info = await contract.userInfo(userAddress);

        const depositedEl = document.getElementById("deposited");
        const pendingEl = document.getElementById("pending");
        const claimedEl = document.getElementById("claimed");

        depositedEl.innerText = ethers.formatUnits(info.deposited, 18);
        pendingEl.innerText = ethers.formatUnits(info.claimable, 18);
        claimedEl.innerText = ethers.formatUnits(info.claimed, 18);

    } catch (err) {
        console.error("Refresh failed:", err);
        statusBox.innerText = "Failed to refresh user data";
    }
}

/* =========================
   DEPOSIT BUTTON
========================= */

btnDeposit.onclick = async () => {
    if (!contract || !userAddress) return;
    const amount = inputDeposit.value;
    if (!amount || Number(amount) <= 0) {
        alert("Enter a valid amount to deposit");
        return;
    }

    try {
        const tx = await contract.deposit(ethers.parseUnits(amount, 18));
        statusBox.innerText = "Depositing...";
        await tx.wait();
        statusBox.innerText = `Deposited ${amount}`;
        inputDeposit.value = "";
        await refreshUserData();
    } catch (err) {
        console.error(err);
        statusBox.innerText = "Deposit failed";
    }
};

/* =========================
   CLAIM BUTTON
========================= */

btnClaim.onclick = async () => {
    if (!contract || !userAddress) return;

    try {
        const tx = await contract.claim();
        statusBox.innerText = "Claiming...";
        await tx.wait();
        statusBox.innerText = "Claim successful";
        await refreshUserData();
    } catch (err) {
        console.error(err);
        statusBox.innerText = "Claim failed (maybe no rewards yet)";
    }
};
