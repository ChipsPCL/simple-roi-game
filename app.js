let provider;
let signer;
let userAddress;

const statusBox = document.getElementById("status");
const btnConnect = document.getElementById("btnConnect");

/* =========================
   CONTRACT CONFIG
========================= */

const CONTRACT_ADDRESS = "0xa986e428b39abea31c982fe02b283b845e3005c8";

const ABI = [
    "function userInfo(address) view returns (uint256 deposited, uint256 claimable, uint256 claimed)"
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

        console.log("User info:", info);

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

