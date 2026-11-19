import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { RUNTIME_CONFIG, type RuntimeConfig } from "../../../common/config/runtime-config";

export const MEDIA_STORAGE = Symbol("MEDIA_STORAGE");
export interface MediaStorageGateway {
  put(key: string, body: Buffer, mime: "image/webp" | "application/pdf"): Promise<void>;
  delete(key: string): Promise<void>;
  privateDownloadUrl(key: string, filename: string): Promise<string>;
}

@Injectable()
export class S3MediaStorageGateway implements MediaStorageGateway {
  private readonly client: S3Client | null;
  private readonly bucket: string | null;
  constructor(@Inject(RUNTIME_CONFIG) config: RuntimeConfig) {
    const storage = config.mediaStorage;
    this.client = storage ? new S3Client({
      region: storage.region,
      ...(storage.endpoint ? { endpoint: storage.endpoint } : {}),
      forcePathStyle: storage.forcePathStyle,
      credentials: { accessKeyId: storage.accessKeyId, secretAccessKey: storage.secretAccessKey },
      maxAttempts: 2,
    }) : null;
    this.bucket = storage?.bucket ?? null;
  }
  private requireClient(): { client: S3Client; bucket: string } {
    if (!this.client || !this.bucket) throw new ServiceUnavailableException({
      code: "MEDIA_STORAGE_NOT_CONFIGURED", message: "Media storage is not configured",
    });
    return { client: this.client, bucket: this.bucket };
  }
  async put(key: string, body: Buffer, mime: "image/webp" | "application/pdf"): Promise<void> {
    const { client, bucket } = this.requireClient();
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: body, ContentType: mime,
      CacheControl: mime === "image/webp" ? "public,max-age=31536000,immutable" : "private,no-store",
      ContentDisposition: mime === "application/pdf" ? "attachment" : "inline",
    }));
  }
  async delete(key: string): Promise<void> {
    const { client, bucket } = this.requireClient();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
  async privateDownloadUrl(key: string, filename: string): Promise<string> {
    const { client, bucket } = this.requireClient();
    // Only authorized application callers may generate this 60-second bearer URL.
    const asciiFilename = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100) || "document.pdf";
    return getSignedUrl(client, new GetObjectCommand({
      Bucket: bucket, Key: key, ResponseContentType: "application/pdf",
      ResponseContentDisposition: 'attachment; filename="' + asciiFilename + '"',
      ResponseCacheControl: "private,no-store",
    }), { expiresIn: 60 });
  }
}
