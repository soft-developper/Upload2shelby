import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import cors from "cors";
import { ShelbyNodeClient } from "@shelby-protocol/sdk/node";
//import { Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";
import { Account, Ed25519PrivateKey, Network } from "@aptos-labs/ts-sdk";
import path from "path";

// ─── App Setup ──────────────────────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json());

// ─── Validate required env vars ─────────────────────────────────────────────

const PRIVATE_KEY = process.env.SHELBY_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error("❌  SHELBY_PRIVATE_KEY is missing from server/.env");
  console.error("    Run: shelby account show  — then copy the private key.");
  process.exit(1);
}

// ─── Shelby Client ───────────────────────────────────────────────────────────
//
//  ShelbyNodeClient is the server-side client for the Shelby Protocol.
//  It talks to the Shelby RPC node and the Aptos blockchain.
//
//  ShelbyNetwork.SHELBYNET = Shelby testnet  (use for development)
//  ShelbyNetwork.MAINNET   = production
//
const shelbyClient = new ShelbyNodeClient({
  network: Network.SHELBYNET,
});

// ─── Signer ──────────────────────────────────────────────────────────────────
//
//  Every upload requires an on-chain transaction signed by an Aptos account.
//  The account also pays the storage fee in ShelbyUSD / APT.
//  The private key lives in server/.env and never leaves the server.
//
const signer = Account.fromPrivateKey({
  privateKey: new Ed25519PrivateKey(PRIVATE_KEY),
});

console.log(`🔑 Signer address: ${signer.accountAddress}`);

// ─── Multer (in-memory — no files written to disk) ───────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per file
});

// ─── Shared type (mirrors client/src/types.ts) ───────────────────────────────

interface UploadedFile {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  blobName: string;
  expiresAt: string;       // ISO 8601
  signerAddress: string;
}

// ─── POST /api/upload ────────────────────────────────────────────────────────
//
//  Multipart form fields:
//    files        (required) — one or more files, up to 10
//    blobPrefix   (optional) — storage folder prefix, default "uploads"
//    daysToExpire (optional) — how many days before the blob expires, default 7
//
//  Response:
//    { success: true,  files: UploadedFile[] }
//    { success: false, error: string }
//
app.post(
  "/api/upload",
  upload.array("files", 10),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = req.files as Express.Multer.File[] | undefined;

      if (!files || files.length === 0) {
        res.status(400).json({ success: false, error: "No files received." });
        return;
      }

      const blobPrefix    = (req.body.blobPrefix   as string) || "uploads";
      const daysToExpire  = Math.max(1, Number(req.body.daysToExpire) || 7);

      // Shelby SDK expects expiry as a Unix timestamp in MICROSECONDS
      const expirationMicros =
        Date.now() * 1_000 +                        // now in µs
        daysToExpire * 24 * 60 * 60 * 1_000_000;    // + N days in µs

      const results: UploadedFile[] = [];

      for (const file of files) {
        // Build a unique, safe blob path  e.g. "uploads/1715000000000-photo.jpg"
        const safeName = path.basename(file.originalname).replace(/\s+/g, "_");
        const blobName = `${blobPrefix}/${Date.now()}-${safeName}`;

        // ── Shelby SDK upload call ────────────────────────────────────────
        //
        //  client.upload() signature:
        //    blobData        — Uint8Array  (Buffer satisfies this)
        //    signer          — Aptos Account (signs + pays the transaction)
        //    blobName        — path string, e.g. "uploads/photo.jpg"
        //    expirationMicros — µs timestamp when the blob expires on-chain
        //
        await shelbyClient.upload({
          blobData: file.buffer,   // multer gives us a Buffer, which is a Uint8Array
          signer,
          blobName,
          expirationMicros,
        });
        // ─────────────────────────────────────────────────────────────────

        results.push({
          originalName:  file.originalname,
          mimeType:      file.mimetype,
          sizeBytes:     file.size,
          blobName,
          expiresAt:     new Date(expirationMicros / 1_000).toISOString(),
          signerAddress: signer.accountAddress.toString(),
        });
      }

      res.json({ success: true, files: results });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/health ─────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({
    status:    "ok",
    network:   "shelbynet",
    signer:    signer.accountAddress.toString(),
    timestamp: new Date().toISOString(),
  });
});

// ─── GET /api/history ─────────────────────────────────────────────────────────

app.get("/api/history", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const address = req.query.address as string;
    if (!address) {
      res.status(400).json({ success: false, error: "address query param required" });
      return;
    }

    const indexerUrl = "https://api.shelbynet.aptoslabs.com/nocode/v1/public/alias/shelby/shelbynet/v1/graphql";
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.APTOS_API_KEY || ""}`,
      "x-api-key": process.env.APTOS_API_KEY || "",
    };

    // ── Fetch last 20 blobs ───────────────────────────────────────────────
    const blobsQuery = `
      query getBlobs($where: blobs_bool_exp, $orderBy: [blobs_order_by!], $limit: Int) {
        blobs(where: $where, order_by: $orderBy, limit: $limit) {
          owner
          blob_name
          expires_at
          created_at
          size
          is_written
        }
      }
    `;

    // ── Fetch total count ─────────────────────────────────────────────────
    const countQuery = `
      query getBlobsCount($where: blobs_bool_exp) {
        blobs_aggregate(where: $where) {
          aggregate {
            count
          }
        }
      }
    `;

    const where = {
      owner: { _eq: signer.accountAddress.toString() },
      is_deleted: { _eq: 0 },
    };

    // Run both queries in parallel
    const [blobsRes, countRes] = await Promise.all([
      fetch(indexerUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: blobsQuery,
          variables: { where, orderBy: [{ created_at: "desc" }], limit: 20 },
        }),
      }),
      fetch(indexerUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: countQuery,
          variables: { where },
        }),
      }),
    ]);

    const blobsJson = await blobsRes.json() as any;
    const countJson = await countRes.json() as any;

    const totalUploads = countJson.data?.blobs_aggregate?.aggregate?.count ?? 0;

    const blobs = (blobsJson.data?.blobs ?? []).map((b: any) => ({
      blobName:  b.blob_name,
      expiresAt: new Date(Number(b.expires_at) / 1000).toISOString(),
      createdAt: new Date(Number(b.created_at) / 1000).toISOString(),
      sizeBytes: Number(b.size),
      isWritten: b.is_written === "1",
    }));

    res.json({ success: true, blobs, totalUploads });
  } catch (err) {
    next(err);
  }
});


// ─── GET /api/preview ────────────────────────────────────────────────────────

app.get("/api/preview", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const blobName = req.query.blobName as string;
    if (!blobName) {
      res.status(400).json({ error: "blobName required" });
      return;
    }

    const ext = blobName.split(".").pop()?.toLowerCase() ?? "";
    const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"];
    if (!imageExts.includes(ext)) {
      res.status(415).json({ error: "Not an image" });
      return;
    }

    const relativeBlobName = blobName
      .replace(/^@[^/]+\//, "")
      .trim();

    console.log("[preview] downloading:", relativeBlobName);

    const blob = await shelbyClient.download({
      account: signer.accountAddress,
      blobName: relativeBlobName,
    });

    const chunks: Uint8Array[] = [];
    const reader = blob.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));

    const mimeMap: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif",
    };

    res.setHeader("Content-Type", mimeMap[ext] || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});


// ─── Global error handler ────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[upload error]", err.message);
  res.status(500).json({ success: false, error: err.message || "Upload failed" });
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✅ Shelby upload server → http://localhost:${PORT}`);
});
