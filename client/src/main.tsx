import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";
import { Network } from "@aptos-labs/ts-sdk";
import App from "./App.tsx";
import SharePage from "./pages/SharePage.tsx";

const isSharePage = window.location.pathname === "/share";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isSharePage ? (
      <SharePage />
    ) : (
      <AptosWalletAdapterProvider
        autoConnect={false}
        dappConfig={{
          network: Network.TESTNET,
          aptosApiKeys: import.meta.env.VITE_APTOS_API_KEY || ""
        }}
        disableTelemetry={true}
        onError={(error) => console.error("Wallet error:", error)}
      >
        <App />
      </AptosWalletAdapterProvider>
    )}
  </StrictMode>
);
