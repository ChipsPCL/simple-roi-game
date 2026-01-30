let provider;
let signer;
let userAddress;
let contract;
let token;

/* =========================
   CONFIG
========================= */

const CONTRACT_ADDRESS = "0xa986e428b39abea31c982fe02b283b845e3005c8";

const ABI = [
    "function deposit(uint256 amount)",
    "function claim()",
    "function depositToken() view returns (address)",
    "function pendingRewards(address) view returns (uint256)",
    "function userInfo(address) view returns (uint256 deposited, uint256 claimable, uint256 claimed)"
];

const ERC20_ABI = [
    "function approve(address spender, uint256 amount)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function decimals() view returns (uint8)"
];

/* =========================
   ELEMENTS
========================= */

const statusBox = document.getElementById("status");
const btnConnect = document.getElementById("btnConnect");
const btnDeposit = document.getElementById("btnDeposit");
const btnClaim = document.getElementById("btnClaim");


/* =========================
   CONNECT WALLET
========================= */

btnConnect.onclick = async () => {
    try {
        if (!window.ethereum) {
            statusBox.innerText = "No wallet found";
            return;
        }

        provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send("eth_requestAccounts", []);

        signer = await provider.getSigner();
        userAddress = await signer.getAddress();

        contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

        const tokenAddress = await contract.depositToken();
        token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);

        statusBox.innerText = `Connected: ${userAddress}`;

        // Try refresh safely
        await safeRefresh();

    } catch (err) {
        console.error("Connect error:", err);
        statusBox.innerText = "Wallet connection failed";
    }
};

/* =========================
   SAFE REFRESH
========================= */

async function safeRefresh() {
    try {
        const info = await contract.userInfo(userAddress);

        document.getElementById("deposited").innerText =
            ethers.formatUnits(info.deposited, 18);

        document.getElementById("pending").innerText =
            ethers.formatUnits(info.claimable, 18);

        document.getElementById("claimed").innerText =
            ethers.formatUnits(info.claimed, 18);

    } catch (err) {
        console.warn("userInfo not available yet (safe to ignore)");
    }
}

/* =========================
   DEPOSIT FLOW
========================= */

btnDeposit.onclick = async () => {
    try {
        const input = document.getElementById("depositAmount");
        if (!input) {
            alert("Deposit input not found");
            return;
        }

        const raw = input.value;
        if (!raw || raw <= 0) return;

        const amount = ethers.parseUnits(raw, 18);

        const allowance = await token.allowance(userAddress, CONTRACT_ADDRESS);

        if (allowance < amount) {
            statusBox.innerText = "Approving token...";
            const approveTx = await token.approve(CONTRACT_ADDRESS, amount);
            await approveTx.wait();
        }

        statusBox.innerText = "Depositing...";
        const tx = await contract.connect(signer).deposit(amount);
        await tx.wait();

        statusBox.innerText = "Deposit successful";
        await safeRefresh();

    } catch (err) {
        console.error("Deposit failed:", err);
        statusBox.innerText = "Deposit failed";
    }
};

/* =========================
   CLAIM
========================= */

btnClaim.onclick = async () => {
   try {
        statusBox.innerText = "Claiming rewards...";
        const tx = await contract.connect(signer).claim();
        await tx.wait();

        statusBox.innerText = "Claim successful";
        await safeRefresh();

    } catch (err) {
        console.error("Claim failed:", err);
        statusBox.innerText = "Nothing to claim or insufficient rewards";
    }
};
