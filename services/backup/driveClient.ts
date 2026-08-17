import * as FileSystem from "expo-file-system/legacy";

/**
 * Minimal Google Drive v3 client, scoped to the hidden `appDataFolder`.
 *
 * Hand-rolled REST rather than googleapis: the official client is a Node library
 * that pulls in http/stream/zlib polyfills and adds megabytes to a React Native
 * bundle, for four endpoints. `fetch` is enough for metadata, and file bytes go
 * through expo-file-system so the database never has to be loaded into JS memory
 * as a base64 string.
 *
 * Everything lives in `appDataFolder`: invisible in the user's Drive UI, exempt
 * from their storage quota, and unreachable by any other app — so a backup can't
 * be accidentally deleted, renamed or opened by the user, and Avent can't see
 * any of their other files.
 */

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

export const BACKUP_FILE_NAME = "avent-backup.db";
const BACKUP_MIME = "application/x-sqlite3";

export interface DriveFileInfo {
  id: string;
  name: string;
  size: number | null;
  modifiedTime: string | null;
  appProperties: Record<string, string>;
}

export class DriveApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DriveApiError";
    this.status = status;
  }
}

async function assertOk(response: Response, action: string): Promise<void> {
  if (response.ok) return;

  // Drive returns a JSON error envelope, but a proxy or captive portal can
  // return HTML — so the body is read as text and only then parsed.
  let detail = "";
  try {
    const body = await response.text();
    try {
      detail = JSON.parse(body)?.error?.message ?? body.slice(0, 200);
    } catch {
      detail = body.slice(0, 200);
    }
  } catch {
    detail = response.statusText;
  }

  throw new DriveApiError(
    response.status,
    `Drive ${action} failed (${response.status}): ${detail}`
  );
}

/**
 * Finds the single backup file, or null on a fresh account.
 *
 * `spaces=appDataFolder` is mandatory — the default search space is the user's
 * visible Drive, where this file does not exist, so omitting it returns an empty
 * list and the app concludes "no backup yet" and happily overwrites nothing.
 */
export async function findBackupFile(
  accessToken: string
): Promise<DriveFileInfo | null> {
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    q: `name = '${BACKUP_FILE_NAME}' and trashed = false`,
    fields: "files(id,name,size,modifiedTime,appProperties)",
    pageSize: "10",
    orderBy: "modifiedTime desc",
  });

  const response = await fetch(`${DRIVE_FILES}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await assertOk(response, "lookup");

  const json = await response.json();
  const file = json?.files?.[0];
  if (!file) return null;

  return {
    id: file.id,
    name: file.name,
    size: file.size != null ? Number(file.size) : null,
    modifiedTime: file.modifiedTime ?? null,
    appProperties: file.appProperties ?? {},
  };
}

/**
 * Uploads (or replaces) the backup using a resumable session.
 *
 * Two steps rather than one multipart request, because a multipart upload needs
 * the file bytes inside a `multipart/related` body — which in React Native means
 * base64-encoding the whole database into a JS string. A 20 MB database becomes
 * ~27 MB of string in memory and reliably OOMs cheap Android devices. The
 * resumable session lets expo-file-system stream the file straight from disk.
 *
 * Passing `existingFileId` PATCHes the same file so the account keeps exactly
 * one backup instead of accumulating one per run.
 */
export async function uploadBackup(params: {
  accessToken: string;
  fileUri: string;
  fileSize: number;
  existingFileId?: string | null;
  appProperties?: Record<string, string>;
}): Promise<DriveFileInfo> {
  const { accessToken, fileUri, fileSize, existingFileId, appProperties } =
    params;

  const isUpdate = Boolean(existingFileId);
  const sessionUrl = isUpdate
    ? `${DRIVE_UPLOAD}/${existingFileId}?uploadType=resumable&fields=id,name,size,modifiedTime,appProperties`
    : `${DRIVE_UPLOAD}?uploadType=resumable&fields=id,name,size,modifiedTime,appProperties`;

  const metadata: Record<string, unknown> = {
    name: BACKUP_FILE_NAME,
    ...(appProperties ? { appProperties } : {}),
    // `parents` is only legal on create. Sending it on an update is rejected
    // with "The parents field is not directly writable in update requests".
    ...(isUpdate ? {} : { parents: ["appDataFolder"] }),
  };

  const initResponse = await fetch(sessionUrl, {
    method: isUpdate ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": BACKUP_MIME,
      "X-Upload-Content-Length": String(fileSize),
    },
    body: JSON.stringify(metadata),
  });
  await assertOk(initResponse, "upload handshake");

  const uploadUrl =
    initResponse.headers.get("location") ??
    initResponse.headers.get("Location");
  if (!uploadUrl) {
    throw new DriveApiError(
      500,
      "Drive didn't return an upload URL for the resumable session."
    );
  }

  const uploadResult = await FileSystem.uploadAsync(uploadUrl, fileUri, {
    httpMethod: "PUT",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { "Content-Type": BACKUP_MIME },
  });

  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw new DriveApiError(
      uploadResult.status,
      `Drive upload failed (${uploadResult.status}): ${uploadResult.body?.slice(
        0,
        200
      )}`
    );
  }

  const file = JSON.parse(uploadResult.body || "{}");
  return {
    id: file.id ?? existingFileId ?? "",
    name: file.name ?? BACKUP_FILE_NAME,
    size: file.size != null ? Number(file.size) : fileSize,
    modifiedTime: file.modifiedTime ?? null,
    appProperties: file.appProperties ?? appProperties ?? {},
  };
}

/**
 * Streams the backup to `destUri`.
 *
 * `alt=media` is what returns the bytes; without it Drive returns the file's
 * JSON metadata, and the "database" written to disk would be a few hundred bytes
 * of JSON that fails to open with a confusing "file is not a database".
 */
export async function downloadBackup(params: {
  accessToken: string;
  fileId: string;
  destUri: string;
}): Promise<{ uri: string; size: number }> {
  const { accessToken, fileId, destUri } = params;

  const result = await FileSystem.downloadAsync(
    `${DRIVE_FILES}/${fileId}?alt=media`,
    destUri,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (result.status < 200 || result.status >= 300) {
    throw new DriveApiError(
      result.status,
      `Drive download failed (${result.status}).`
    );
  }

  const info = await FileSystem.getInfoAsync(result.uri);
  return {
    uri: result.uri,
    size: info.exists && "size" in info ? (info.size as number) : 0,
  };
}

export async function deleteBackup(
  accessToken: string,
  fileId: string
): Promise<void> {
  const response = await fetch(`${DRIVE_FILES}/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // 404 means someone already removed it — the desired end state either way.
  if (response.status === 404) return;
  await assertOk(response, "delete");
}
