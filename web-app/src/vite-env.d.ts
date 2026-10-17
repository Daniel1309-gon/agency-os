/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_EXTENSION_ID?: string;
  readonly VITE_LOCAL_AGENT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
