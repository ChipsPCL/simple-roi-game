let provider;
let signer;
let userAddress;

const statusBox = document.getElementById("status");
const btnConnect = document.getElementById("btnConnect");
const btnDeposit = document.getElementById("btnDeposit");

/* =========================
   CONTRACT CONFIG
========================= */

const CONTRACT_ADDRESS = "0xa986e428b39abea31c982fe02b283b845e3005c8";

const ABI = [
    "function userInfo(address) view returns (uint256 deposited, uint256 claimable, uint256 claimed)",
    "function depositToken() view returns (address)",
    "function deposit(uint256 amount)"
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
            provider
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
   READ USER DATA
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
        console.error("Failed to refresh user data:", err);
    }
}

/* =========================
   STEP 9: DEPOSIT LOGIC
========================= */

btnDeposit.onclick = async () => {
    if (!signer || !userAddress) {
        alert("Connect wallet first");
        return;
    }

    const amountInput = document.getElementById("depositAmount").value;
    if (!amountInput || amountInput <= 0) {
        alert("Enter a valid amount");
        return;
    }

    try {
        statusBox.innerText = "Preparing deposit...";

        // Get deposit token address
        const tokenAddress = await contract.depositToken();

        const tokenAbi = [
            "function approve(address spender, uint256 amount) returns (bool)",
            "function decimals() view returns (uint8)"
        ];

        const token = new ethers.Contract(tokenAddress, tokenAbi, signer);

        const decimals = await token.decimals();
        const amount = ethers.parseUnits(amountInput, decimals);

        // Approve
        statusBox.innerText = "Approving tokens...";
        const approveTx = await token.approve(CONTRACT_ADDRESS, amount);
        await approveTx.wait();

        // Deposit
        statusBox.innerText = "Depositing...";
        const depositTx = await contract.connect(signer).deposit(amount);
        await depositTx.wait();

        statusBox.innerText = "Deposit successful!";
        await refreshUserData();

    } catch (err) {
        console.error(err);
        statusBox.innerText = "Deposit failed";
    }
};
