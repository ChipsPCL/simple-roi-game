let provider;
let signer;
let userAddress;

const statusBox = document.getElementById("status");
const btnConnect = document.getElementById("btnConnect");
const btnDeposit = document.getElementById("btnDeposit");
const btnClaim = document.getElementById("btnClaim");

/* =========================
   CONTRACT CONFIG
========================= */

const CONTRACT_ADDRESS = "0xa986e428b39abea31c982fe02b283b845e3005c8";

const ABI = [
    "function userInfo(address) view returns (uint256 deposited, uint256 claimable, uint256 claimed)",
    "function deposit(uint256 amount)",
    "function claim()",
    "function depositToken() view returns (address)"
];

let contract;

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

        contract = new ethers.Contract(
            CONTRACT_ADDRESS,
            ABI,
            signer
        );

        statusBox.innerText = `Connected: ${userAddress}`;
        console.log("Connected:", userAddress);

        await refreshUserData();

    } catch (err) {
        console.error(err);
        statusBox.innerText = "Connection failed";
    }
};

/* =========================
   DEPOSIT BUTTON
========================= */

btnDeposit.onclick = async () => {
    const inputDeposit = document.getElementById("inputDeposit");
    const amount = inputDeposit.value;

    if (!amount || Number(amount) <= 0) {
        alert("Enter a valid amount");
        return;
    }

    try {
        const tokenAddress = await contract.depositToken();
        const tokenContract = new ethers.Contract(
            tokenAddress,
            ["function approve(address spender, uint256 amount) public returns (bool)"],
            signer
        );

        const parsedAmount = ethers.parseUnits(amount, 18);

        // Approve contract to spend tokens first
        const approveTx = await tokenContract.approve(CONTRACT_ADDRESS, parsedAmount);
        await approveTx.wait();

        // Deposit
        const tx = await contract.deposit(parsedAmount);
        await tx.wait();

        console.log("Deposit successful:", amount);
        await refreshUserData();

    } catch (err) {
        console.error("Deposit failed:", err);
        alert("Deposit failed, check console");
    }
};

/* =========================
   CLAIM BUTTON
========================= */

btnClaim.onclick = async () => {
    try {
        const tx = await contract.claim();
        await tx.wait();
        console.log("Claim successful");
        await refreshUserData();
    } catch (err) {
        console.error("Claim failed:", err);
        alert("Claim failed, check console");
    }
};

/* =========================
   REFRESH USER DATA
========================= */

async function refreshUserData() {
    if (!contract || !userAddress) return;

    try {
        const info = await contract.userInfo(userAddress);

        console.log("User info:", info);

        const depositedEl = document.getElementById("deposited");
        const pendingEl = document.getElementById("pending");
        const claimedEl = document.getElementById("claimed");

        depositedEl.innerText = ethers.formatUnits(info.deposited, 18);
        pendingEl.innerText = ethers.formatUnits(info.claimable, 18);
        claimedEl.innerText = ethers.formatUnits(info.claimed, 18);

    } catch (err) {
        console.error("Refresh failed:", err);
        statusBox.innerText = "Failed to refresh data";
    }
}
