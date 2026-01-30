let provider;
let signer;
let userAddress;
let contract;
let token;

const statusBox = document.getElementById("status");
const btnConnect = document.getElementById("btnConnect");
const btnDeposit = document.getElementById("btnDeposit");

/* =========================
   CONFIG
========================= */

const CONTRACT_ADDRESS = "0xa986e428b39abea31c982fe02b283b845e3005c8";

// 🔥 EXACT ABI FROM BASESCAN (trimmed to what we use)
const ABI = [
    "function deposit(uint256 amount)",
    "function claim()",
    "function userInfo(address) view returns (uint256 deposited, uint256 claimable, uint256 claimed)",
    "function pendingRewards(address) view returns (uint256)",
    "function depositToken() view returns (address)"
];

const ERC20_ABI = [
    "function approve(address spender, uint256 amount)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function decimals() view returns (uint8)"
];

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
            provider
        );

        const tokenAddress = await contract.depositToken();
        token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);

        statusBox.innerText = `Connected: ${userAddress}`;
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
    try {
        const info = await contract.userInfo(userAddress);

        document.getElementById("deposited").innerText =
            ethers.formatUnits(info.deposited, 18);

        document.getElementById("pending").innerText =
            ethers.formatUnits(info.claimable, 18);

        document.getElementById("claimed").innerText =
            ethers.formatUnits(info.claimed, 18);

    } catch (err) {
        console.error("Refresh failed:", err);
    }
}

/* =========================
   DEPOSIT (APPROVE + DEPOSIT)
========================= */

btnDeposit.onclick = async () => {
    try {
        const amountInput = document.getElementById("depositAmount").value;
        if (!amountInput || amountInput <= 0) return;

        const amount = ethers.parseUnits(amountInput, 18);

        const allowance = await token.allowance(userAddress, CONTRACT_ADDRESS);

        if (allowance < amount) {
            statusBox.innerText = "Approving token...";
            const approveTx = await token.approve(CONTRACT_ADDRESS, amount);
            await approveTx.wait();
        }

        statusBox.innerText = "Depositing...";
        const depositTx = await contract.connect(signer).deposit(amount);
        await depositTx.wait();

        statusBox.innerText = "Deposit successful";
        await refreshUserData();

    } catch (err) {
        console.error(err);
        statusBox.innerText = "Deposit failed";
    }
};
