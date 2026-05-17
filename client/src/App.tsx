import DurationSlider from "./components/DurationSlider";
import { useState, useCallback, useRef } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import WalletBar from "./components/WalletBar";
import DropZone from "./components/DropZone";
import UploadQueue from "./components/UploadQueue";
import ConfirmationPanel from "./components/ConfirmationPanel";
import UploadHistory from "./components/UploadHistory";
import type { QueuedFile, UploadedFile } from "./types";
import "./App.css";

//const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

export default function App() {
  const { connected, account, signMessage } = useWallet();
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [confirmed, setConfirmed] = useState<UploadedFile[]>([]);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [storageDays, setStorageDays] = useState(30);
  const [signError, setSignError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const enqueue = useCallback((files: File[]) => {
    const entries: QueuedFile[] = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      status: "pending",
      progress: 0,
    }));
    setQueue((q) => [...q, ...entries]);
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setQueue((q) => q.filter((f) => f.id !== id));
  }, []);

  const startUpload = useCallback(async () => {
    const pending = queue.filter((f) => f.status === "pending");
    if (pending.length === 0 || !account) return;

    setSignError(null);
    setIsUploading(true);

    // Step 1: ask wallet to sign a message — proves ownership before upload
    let signature: string;
    let walletAddress: string;
    try {
      const message = `Authorize Shelby upload\nWallet: ${account.address}\nTime: ${Date.now()}`;
      const response = await signMessage({
        message,
        nonce: Date.now().toString(),
      });
      signature = response.signature.toString();
      walletAddress = account.address.toString();
    } catch (err) {
      setSignError("Wallet signature was rejected. Upload cancelled.");
      setIsUploading(false);
      return;
    }

    // Step 2: mark files as uploading
    setQueue((q) =>
      q.map((f) =>
        f.status === "pending" ? { ...f, status: "uploading", progress: 0 } : f
      )
    );

    // Step 3: send files + signature to server
    const formData = new FormData();
    pending.forEach((qf) => formData.append("files", qf.file));
    formData.append("blobPrefix", "uploads");
    formData.append("daysToExpire", storageDays.toString());
    formData.append("signature", signature);
    formData.append("walletAddress", walletAddress);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const result = await uploadWithProgress(formData, (pct) => {
        setQueue((q) =>
          q.map((f) =>
            f.status === "uploading" ? { ...f, progress: pct } : f
          )
        );
      }, abort.signal);

      setQueue((q) =>
        q.map((f) =>
          f.status === "uploading" ? { ...f, status: "done", progress: 100 } : f
        )
      );
      setConfirmed((prev) => [...prev, ...result.files]);
      setHistoryRefresh((r) => r + 1);
      setStorageDays(30);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setQueue((q) =>
        q.map((f) =>
          f.status === "uploading" ? { ...f, status: "error", error: message } : f
        )
      );
    } finally {
      setIsUploading(false);
      abortRef.current = null;
    }
  }, [queue, account, signMessage,storageDays]);

  const clearQueue = useCallback(() => {
    setQueue((q) => q.filter((f) => f.status !== "done"));
  }, []);

  const clearConfirmed = useCallback(() => setConfirmed([]), []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-top">
          <div className="logo">
            <span className="logo-icon">◈</span>
            <span className="logo-text">EA<em>SY</em></span>
          </div>
          <WalletBar />
        </div>
        <p className="tagline">Decentralized cloud storage — connect wallet, drop files, done.</p>
      </header>

      <main className="app-main">
        {!connected ? (
          <div className="wallet-gate">
            <div className="wallet-gate__icon">◈</div>
            <h2 className="wallet-gate__title">Connect your wallet to upload</h2>
            <p className="wallet-gate__sub">
              An Aptos wallet is required to authorize uploads to Shelby storage.
              Connect using the button in the top right.
            </p>
          </div>
        ) : (
          <>
            <DropZone onFiles={enqueue} disabled={isUploading} />
<DurationSlider
  days={storageDays}
  onChange={setStorageDays}
  disabled={isUploading}
/>

            {signError && (
              <div className="sign-error">{signError}</div>
            )}

            {queue.length > 0 && (
              <UploadQueue
                queue={queue}
                isUploading={isUploading}
                onRemove={removeFromQueue}
                onUpload={startUpload}
                onClear={clearQueue}
              />
            )}

            {confirmed.length > 0 && (
              <ConfirmationPanel files={confirmed} onDismiss={clearConfirmed} />
            )}

            <UploadHistory walletAddress={account?.address.toString() ?? ""} refresh={historyRefresh} />
          </>
        )}
      </main>
    </div>
  );
}

function uploadWithProgress(
  formData: FormData,
  onProgress: (pct: number) => void,
  signal: AbortSignal
): Promise<{ files: UploadedFile[] }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        try {
          reject(new Error(JSON.parse(xhr.responseText).error || `HTTP ${xhr.status}`));
        } catch {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));
    signal.addEventListener("abort", () => xhr.abort());
    xhr.open("POST", `${import.meta.env.VITE_API_URL || "http://localhost:4000"}/api/upload`);
    xhr.send(formData);
  });
}
