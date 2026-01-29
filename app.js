let provider;
let signer;
let userAddress;
let contract;

const statusBox = document.getElementById("status");
const btnConnect = document.getElementById("btnConnect");
const btnDeposit = document.getElementById("btnDeposit");

const inputDeposit = document.getElementById("inputDeposit");

const depositedEl = document.getElementById("deposited");
const pendingEl = document.getElementById("pending");
const claimedEl = document.getElementById("claimed");

/* =========================
   CONTRACT CONFIG
========================= */

const CONTRACT_ADDRESS = "0xa986e428b39abea31c982fe02b283b845e3005c8";

const ABI = [
    "function deposit(uint256 amount)",
    "function userInfo(address) view returns (uint256 deposited, uint256 claimable, uint256 claimed)"
];

// ERC20 ABI (approve only)
const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)"
];

let tokenContract;

/* =========================
   WALLET CONNECT
========================= */

btnConnect.onclick = async () => {
    if (!window.ethereum) {
        statusBox.innerText = "❌ No wallet detected";
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

        // deposit token = same token used by contract
        const tokenAddress = await contract.depositToken?.() // optional safety
            .catch(() => null);

        if (tokenAddress) {
            tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
        }

        statusBox.innerText = `✅ Connected: ${userAddress}`;
        await refreshUserData();

    } catch (err) {
        console.error(err);
        statusBox.innerText = "❌ Connection failed";
    }
};

/* =========================
   DEPOSIT
========================= */

btnDeposit.onclick = async () => {
    if (!contract || !signer) {
        statusBox.innerText = "⚠️ Connect wallet first";
        return;
    }

    const rawAmount = inputDeposit.value;
    if (!rawAmount || Number(rawAmount) <= 0) {
        statusBox.innerText = "⚠️ Enter a valid amount";
        return;
    }

    try {
        const amount = ethers.parseUnits(rawAmount, 18);

        statusBox.innerText = "⏳ Approving token...";

        // Approve
        const token = new ethers.Contract(
            await contract.depositToken(),
            ERC20_ABI,
            signer
        );

        const approveTx = await token.approve(CONTRACT_ADDRESS, amount);
        await approveTx.wait();

        statusBox.innerText = "⏳ Depositing...";

        // Deposit
        const tx = await contract.deposit(amount);
        await tx.wait();

        statusBox.innerText = "✅ Deposit successful";

        inputDeposit.value = "";
        await refreshUserData();

    } catch (err) {
        console.error(err);

        if (err.reason) {
            statusBox.innerText = `❌ ${err.reason}`;
        } else {
            statusBox.innerText = "❌ Deposit failed";
        }
    }
};

/* =========================
   READ USER DATA
========================= */

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
