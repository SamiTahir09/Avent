import { GoogleAuthError, getAccessToken } from "./googleAuth";

/**
 * Minimal Google Drive v3 client, scoped to the hidden application data folder.
 *
 * `appDataFolder` is a special per-app space: the `drive.appdata` scope grants
 * access to it and to nothing else, so this module physically cannot read the
 * user's own documents even if it wanted to. The folder is invisible in the
 * Drive UI (Settings → Manage apps is where the user deletes it) and does not
 * count against normal Drive quota rules the way a user-visible file does.
 *
 * Only the handful of calls the backup feature needs are implemented — there is
 * no reason to wrap the rest of the Drive API.
 */

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

export class DriveError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DriveError";
    this.status = status;
  }
}

export interface DriveFile {
  id: string;
  name: string;
  /** RFC 3339 timestamp. */
  modifiedTime: string;
  /** Drive returns size as a string; already coerced here. */
  size: number | null;
}

interface DriveFileResponse {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
}

/** RequestInit narrowed to a plain header object, so the Authorization header
 *  can be merged in without fighting the HeadersInit union. */
type DriveRequest = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

async function driveFetch(
  url: string,
  init: DriveRequest,
  attempt = 0
): Promise<Response> {
  const token = await getAccessToken();

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    throw new DriveError(
      0,
      `Could not reach Google Drive: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  // A 401 here means the token was revoked between the refresh check and this
  // request. getAccessToken() clears the record on a hard rejection, so one
  // retry either succeeds or surfaces "not_connected" to the caller.
  if (response.status === 401 && attempt === 0) {
    return driveFetch(url, init, attempt + 1);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let message = `Google Drive returned ${response.status}`;
    try {
      const parsed = JSON.parse(body);
      if (parsed?.error?.message) message = parsed.error.message;
    } catch {
      if (body) message = body.slice(0, 300);
    }
    throw new DriveError(response.status, message);
  }

  return response;
}

/** The named file in appDataFolder, or null if this app never wrote one. */
export async function findAppDataFile(name: string): Promise<DriveFile | null> {
  const query = new URLSearchParams({
    spaces: "appDataFolder",
    // name = '...' rather than a `contains` search: an exact match keeps this
    // deterministic if a future version adds more files to the folder.
    q: `name = '${name.replace(/'/g, "\\'")}' and trashed = false`,
    fields: "files(id,name,modifiedTime,size)",
    orderBy: "modifiedTime desc",
    pageSize: "10",
  });

  const response = await driveFetch(`${DRIVE_FILES}?${query.toString()}`, {
    method: "GET",
  });
  const json = (await response.json()) as { files?: DriveFileResponse[] };
  const file = json.files?.[0];
  if (!file) return null;

  return {
    id: file.id,
    name: file.name,
    modifiedTime: file.modifiedTime,
    size: file.size ? Number(file.size) : null,
  };
}

/**
 * Creates or overwrites the named JSON file in appDataFolder.
 *
 * Uses multipart upload so the metadata and the body go in one request: a
 * separate create-then-update would leave an empty file behind if the second
 * call failed.
 */
export async function uploadAppDataJson(params: {
  name: string;
  json: string;
  existingFileId?: string | null;
}): Promise<DriveFile> {
  const { name, json, existingFileId } = params;

  const boundary = `avent-${Date.now().toString(36)}`;
  const metadata = existingFileId
    ? { name }
    : { name, parents: ["appDataFolder"] };

  const body =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${json}\r\n` +
    `--${boundary}--`;

  const query = new URLSearchParams({
    uploadType: "multipart",
    fields: "id,name,modifiedTime,size",
  });

  const url = existingFileId
    ? `${DRIVE_UPLOAD}/${existingFileId}?${query.toString()}`
    : `${DRIVE_UPLOAD}?${query.toString()}`;

  const response = await driveFetch(url, {
    method: existingFileId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });

  const file = (await response.json()) as DriveFileResponse;
  return {
    id: file.id,
    name: file.name,
    modifiedTime: file.modifiedTime,
    size: file.size ? Number(file.size) : null,
  };
}

/** Raw text of a Drive file. */
export async function downloadAppDataFile(fileId: string): Promise<string> {
  const response = await driveFetch(`${DRIVE_FILES}/${fileId}?alt=media`, {
    method: "GET",
  });
  return response.text();
}

export async function deleteAppDataFile(fileId: string): Promise<void> {
  await driveFetch(`${DRIVE_FILES}/${fileId}`, { method: "DELETE" });
}

/** Re-exported so callers only need one import for error handling. */
export { GoogleAuthError };
