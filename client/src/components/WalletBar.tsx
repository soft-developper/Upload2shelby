import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useState } from "react";
import "./WalletBar.css";

export default function WalletBar() {
  const { connected, account, wallet, wallets, connect, disconnect } = useWallet();
  const [showModal, setShowModal] = useState(false);

  if (connected && account) {
    const addr = account.address.toString();
    const short = addr.slice(0, 6) + "..." + addr.slice(-4);
    return (
      <div className="walletbar">
        <div className="walletbar__connected">
          {wallet?.icon && (
            <img src={wallet.icon} alt={wallet.name} className="walletbar__icon" />
          )}
          <span className="walletbar__address" title={addr}>{short}</span>
          <button className="btn btn--ghost walletbar__disconnect" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="walletbar">
      <button className="btn btn--primary" onClick={() => setShowModal(true)}>
        Connect Wallet
      </button>

      {showModal && (
        <div className="wallet-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="wallet-modal" onClick={(e) => e.stopPropagation()}>
            <div className="wallet-modal__header">
              <h3>Select a wallet</h3>
              <button className="wallet-modal__close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <ul className="wallet-modal__list">
              {Array.isArray(wallets) && wallets.map((w) => (
                <li key={w.name}>
                  <button
                    className="wallet-modal__item"
                    onClick={() => {
                      connect(w.name);
                      setShowModal(false);
                    }}
                  >
                    {w.icon && (
                      <img src={w.icon} alt={w.name} className="wallet-modal__wallet-icon" />
                    )}
                    <span>{w.name}</span>
                    {"readyState" in w && w.readyState !== "Installed" && (
                      <span className="wallet-modal__install">Install</span>
                    )}
                  </button>
                </li>
              ))}
              {(!wallets || wallets.length === 0) && (
                <li>
                  <p style={{ padding: "16px 20px", color: "var(--text-muted)", fontSize: "13px" }}>
                    No Aptos wallets detected. Install Petra or any AIP-62 wallet.
                  </p>
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
