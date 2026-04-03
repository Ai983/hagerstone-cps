const SCOPES = "https://www.googleapis.com/auth/drive.readonly";

interface GooglePickerDoc {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  url?: string;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

export async function loadGoogleApis(): Promise<void> {
  await loadScript("https://apis.google.com/js/api.js");
  await loadScript("https://accounts.google.com/gsi/client");
  await new Promise<void>((resolve, reject) => {
    if (!window.gapi?.load) {
      reject(new Error("Google API client not available"));
      return;
    }
    window.gapi.load("picker", {
      callback: () => resolve(),
    });
  });
}

export async function getAccessToken(): Promise<string> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  if (!clientId) throw new Error("VITE_GOOGLE_CLIENT_ID is not set");

  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (response) => {
        if (response.error) reject(new Error(response.error));
        else if (!response.access_token) reject(new Error("No access token returned"));
        else resolve(response.access_token);
      },
    });
    client.requestAccessToken();
  });
}

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

export function createPicker(accessToken: string, onPicked: (files: GoogleDriveFile[]) => void): void {
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
  const appId = import.meta.env.VITE_GOOGLE_APP_ID as string | undefined;
  if (!apiKey) throw new Error("VITE_GOOGLE_API_KEY is not set");
  if (!appId) throw new Error("VITE_GOOGLE_APP_ID is not set");

  const view = new window.google.picker.DocsView()
    .setIncludeFolders(true)
    .setSelectFolderEnabled(false)
    .setMimeTypes("application/pdf,image/jpeg,image/png,image/webp");

  const picker = new window.google.picker.PickerBuilder()
    .addView(view)
    .setOAuthToken(accessToken)
    .setDeveloperKey(apiKey)
    .setAppId(appId)
    .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
    .setCallback((data: { action: string; docs?: GooglePickerDoc[] }) => {
      if (data.action === window.google.picker.Action.PICKED && data.docs?.length) {
        const files: GoogleDriveFile[] = data.docs.map((doc) => ({
          id: doc.id,
          name: doc.name,
          mimeType: doc.mimeType,
          sizeBytes: doc.sizeBytes ?? 0,
          url: doc.url ?? "",
        }));
        onPicked(files);
      }
    })
    .setTitle("Select Invoice PDFs or Images")
    .build();

  picker.setVisible(true);
}

export async function downloadFileAsBase64(fileId: string, accessToken: string): Promise<string> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Drive download failed: ${response.status} ${text}`);
  }
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64 ?? "");
    };
    reader.onerror = () => reject(new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}
