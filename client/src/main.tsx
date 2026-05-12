import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";
import { Network } from "@aptos-labs/ts-sdk";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AptosWalletAdapterProvider
      autoConnect={true}
      dappConfig={{ 
        network: Network.TESTNET,
        aptosApiKey: import.meta.env.VITE_APTOS_API_KEY || ""
      }}
      disableTelemetry={true}
      onError={(error) => console.error("Wallet error:", error)}
    >
      <App />
    </AptosWalletAdapterProvider>
  </StrictMode>
);
