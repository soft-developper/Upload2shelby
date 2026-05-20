import { useEffect, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import "../App.css";
import "./ProfilePage.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

interface ApiKey {
  id: number;
  name: string;
  apiKey: string;
  createdAt: string;
}

export default function ProfilePage() {
  const { connected, account, connect, wallets } = useWallet();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [keyName, setKeyName] = useState("");
  const [generating, setGenerating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const walletAddress = account?.address.toString() ?? "";

  const fetchKeys = () => {
    if (!walletAddress) return;
    setLoading(true);
    fetch(`${API}/api/keys?address=${walletAddress}`)
      .then((r) => r.json())
      .then((data) => { if (data.success) setKeys(data.keys); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchKeys(); }, [walletAddress]);

  const handleGenerate = async () => {
    if (!walletAddress) return;
    setGenerating(true);
    try {
      const res = await fetch(`${API}/api/keys/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, name: keyName || "My API Key" }),
      });
      const data = await res.json();
      if (data.success) {
        setNewKey(data.apiKey);
        setKeyName("");
        fetchKeys();
      }
    } catch {
      alert("Failed to generate key");
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this API key? Any agent using it will lose access.")) return;
    await fetch(`${API}/api/keys/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress }),
    });
    fetchKeys();
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-top">
          <div className="logo">
            <span className="logo-icon">◈</span>
            <span className="logo-text">Shelby<em>Easy</em></span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <a href="/marketplace" className="btn btn--ghost">Marketplace</a>
            <a href="/" className="btn btn--ghost">← Upload</a>
          </div>
        </div>
        <p className="tagline">Manage your API keys for agent access</p>
      </header>

      <main className="app-main">
        {!connected ? (
          <div className="wallet-gate">
            <div className="wallet-gate__icon">◈</div>
            <h2 className="wallet-gate__title">Connect your wallet</h2>
            <p className="wallet-gate__sub">You need to connect your wallet to manage API keys.</p>
          </div>
        ) : (
          <>
            {/* ── What is this ── */}
            <div className="profile__info">
              <h2 className="profile__title">Agent API Keys</h2>
              <p className="profile__desc">
                API keys let AI agents and scripts upload and download files on your behalf
                without needing your wallet. Think of them like passwords for your apps.
                Keep them secret — anyone with a key can upload files to your account.
              </p>
            </div>

            {/* ── New key revealed ── */}
            {newKey && (
              <div className="profile__new-key">
                <p className="profile__new-key-label">
                  ✅ Your new API key — copy it now, it won't be shown again:
                </p>
                <div className="profile__key-reveal">
                  <code className="profile__key-code">{newKey}</code>
                  <button
                    className="btn btn--primary"
                    onClick={() => {
                      navigator.clipboard.writeText(newKey);
                      alert("Copied!");
                    }}
                  >
                    Copy
                  </button>
                </div>
                <button className="btn btn--ghost" onClick={() => setNewKey(null)}>
                  I've saved it, dismiss
                </button>
              </div>
            )}

            {/* ── Generate new key ── */}
            <div className="profile__generate">
              <h3 className="profile__section-title">Generate New Key</h3>
              <div className="profile__generate-row">
                <input
                  type="text"
                  className="profile__input"
                  placeholder="Key name (e.g. My AI Agent)"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                />
                <button
                  className="btn btn--primary"
                  onClick={handleGenerate}
                  disabled={generating}
                >
                  {generating ? "Generating..." : "Generate Key"}
                </button>
              </div>
            </div>

            {/* ── Existing keys ── */}
            <div className="profile__keys">
              <h3 className="profile__section-title">
                Your Keys {keys.length > 0 && <span className="history__group-count">{keys.length}</span>}
              </h3>

              {loading && <p className="history__state">Loading...</p>}

              {!loading && keys.length === 0 && (
                <p className="history__state">No API keys yet. Generate one above.</p>
              )}

              {keys.length > 0 && (
                <ul className="profile__key-list">
                  {keys.map((key) => (
                    <li key={key.id} className="profile__key-item">
                      <div className="profile__key-info">
                        <span className="profile__key-name">{key.name}</span>
                        <code className="profile__key-masked">{key.apiKey}</code>
                        <span className="profile__key-date">
                          Created {new Date(key.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <button
                        className="btn btn--ghost profile__key-delete"
                        onClick={() => handleDelete(key.id)}
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* ── How to use ── */}
            <div className="profile__docs">
              <h3 className="profile__section-title">How to Use the Agent API</h3>

              <div className="profile__doc-block">
                <p className="profile__doc-label">Search public files:</p>
                <pre className="profile__code">{`GET ${API}/api/agent/search?q=dataset
Authorization: Bearer sk_your_key_here`}</pre>
              </div>

              <div className="profile__doc-block">
                <p className="profile__doc-label">Download a file:</p>
                <pre className="profile__code">{`GET ${API}/api/agent/download?blobName=uploads/file.csv
Authorization: Bearer sk_your_key_here`}</pre>
              </div>

              <div className="profile__doc-block">
                <p className="profile__doc-label">Upload a file:</p>
                <pre className="profile__code">{`POST ${API}/api/agent/upload
Authorization: Bearer sk_your_key_here
Content-Type: multipart/form-data

files: <your file>
daysToExpire: 30
isPublic: true`}</pre>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
