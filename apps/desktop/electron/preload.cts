import { contextBridge, ipcRenderer } from "electron";

// Deliberately narrow: the renderer gets exactly these two things, nothing
// broader like raw `ipcRenderer` or Node access. `searchWeb` only ever
// forwards a plain query string to the main process and returns its result
// — it can't be used to reach anything else over IPC.
contextBridge.exposeInMainWorld("desktopApp", {
  platform: process.platform,
  searchWeb: (query: string): Promise<{ resultText?: string; error?: string }> =>
    ipcRenderer.invoke("web-search", query),
});
