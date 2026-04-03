declare global {
  interface Window {
    gapi: {
      load: (api: string, callbackOrConfig?: (() => void) | { callback: () => void }) => void;
    };
    google: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
          }) => { requestAccessToken: (overrideConfig?: object) => void };
        };
      };
      picker: {
        DocsView: new () => GooglePickerDocsView;
        PickerBuilder: new () => GooglePickerBuilder;
        Action: { PICKED: string };
        Feature: { MULTISELECT_ENABLED: unknown };
      };
    };
  }
}

interface GooglePickerDocsView {
  setIncludeFolders: (v: boolean) => GooglePickerDocsView;
  setSelectFolderEnabled: (v: boolean) => GooglePickerDocsView;
  setMimeTypes: (types: string) => GooglePickerDocsView;
}

interface GooglePickerBuilder {
  addView: (view: GooglePickerDocsView) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setAppId: (id: string) => GooglePickerBuilder;
  enableFeature: (feature: unknown) => GooglePickerBuilder;
  setCallback: (cb: (data: GooglePickerCallbackData) => void) => GooglePickerBuilder;
  setTitle: (title: string) => GooglePickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
}

interface GooglePickerDoc {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  url?: string;
}

interface GooglePickerCallbackData {
  action: string;
  docs?: GooglePickerDoc[];
}

export {};
