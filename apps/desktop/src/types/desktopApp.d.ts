interface DesktopApp {
  platform: string;
  /** Opens a hidden browser window in the Electron main process and reads
   *  the page — only present when running inside the packaged/dev Electron
   *  shell, not when this renderer is opened in a plain browser. */
  searchWeb: (query: string) => Promise<{ resultText?: string; error?: string }>;
}

interface Window {
  desktopApp?: DesktopApp;
}
