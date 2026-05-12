export interface QueuedFile {
  id: string;
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
}

export interface UploadedFile {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  blobName: string;
  expiresAt: string;
  signerAddress: string;
}
