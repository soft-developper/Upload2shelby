import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";
import { Network } from "@aptos-labs/ts-sdk";
import App from "./App.tsx";
import SharePage from "./pages/SharePage.tsx";
import MarketplacePage from "./pages/MarketplacePage.tsx";
import ProfilePage from "./pages/ProfilePage.tsx";

const path = window.location.pathname;
const isSharePage = path === "/share";
const isMarketplace = path === "/marketplace";
const isProfile = path === "/profile";

const WalletProvider = ({ children }: { children: React.ReactNode }) => (
  <AptosWalletAdapterProvider
    autoConnect={true}
    dappConfig={{
      network: Network.TESTNET,
      aptosApiKeys: import.meta.env.VITE_APTOS_API_KEY || ""
    }}
    disableTelemetry={true}
    onError={(error) => console.error("Wallet error:", error)}
  >
    {children}
  </AptosWalletAdapterProvider>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isSharePage ? (
      <SharePage />
    ) : isMarketplace ? (
      <WalletProvider>
        <MarketplacePage />
      </WalletProvider>
    ) : isProfile ? (
      <WalletProvider>
        <ProfilePage />
      </WalletProvider>
    ) : (
      <WalletProvider>
        <App />
      </WalletProvider>
    )}
  </StrictMode>
);
