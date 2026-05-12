import type { UploadedFile } from "../types";
import "./ConfirmationPanel.css";

interface Props {
  files: UploadedFile[];
  onDismiss: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function shortHash(str?: string): string {
  if (!str) return "-";
  return str.slice(0, 8) + "..." + str.slice(-6);
}

export default function ConfirmationPanel({ files, onDismiss }: Props) {
  return (
    <section className="confirm">
      <div className="confirm__header">
        <div className="confirm__title-row">
          <span className="confirm__check">✓</span>
          <h2 className="confirm__title">
            {files.length} file{files.length !== 1 ? "s" : ""} uploaded to Shelby
          </h2>
        </div>
        <button className="btn btn--ghost" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      <ul className="confirm__list">
        {files.map((f, i) => (
          <li key={i} className="confirm__card">
            <div className="confirm__card-top">
              <span className="confirm__name">{f.originalName}</span>
              <span className="confirm__size">{formatBytes(f.sizeBytes)}</span>
            </div>
            <dl className="confirm__details">
              <div className="confirm__row">
                <dt>Blob name</dt>
                <dd><code>{f.blobName}</code></dd>
              </div>
              <div className="confirm__row">
                <dt>Expires</dt>
                <dd>{new Date(f.expiresAt).toLocaleString()}</dd>
              </div>
              <div className="confirm__row">
                <dt>Signer</dt>
                <dd><code title={f.signerAddress}>{shortHash(f.signerAddress)}</code></dd>
              </div>
              <div className="confirm__row">
                <dt>Explorer</dt>
                <dd>
                  <a href={"https://explorer.shelby.xyz/shelbynet/account/" + f.signerAddress} target="_blank" rel="noopener noreferrer" className="confirm__link">
                    View on Shelby Explorer
                  </a>
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
