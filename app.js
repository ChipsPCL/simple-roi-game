let provider;
let signer;
let userAddress;

const statusBox = document.getElementById("status");
const btnConnect = document.getElementById("btnConnect");

btnConnect.onclick = async () => {
    if (!window.ethereum) {
        statusBox.innerText = "No wallet detected (MetaMask / Rabby)";
        return;
    }

    try {
        provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send("eth_requestAccounts", []);

        signer = await provider.getSigner();
        userAddress = await signer.getAddress();

        statusBox.innerText = `Connected: ${userAddress}`;
        console.log("Wallet connected:", userAddress);

    } catch (err) {
        console.error(err);
        statusBox.innerText = "Connection failed";
    }
};
