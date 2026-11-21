import { app, BrowserWindow, ipcMain, session } from "electron";
import path from "node:path";

const isDev = !app.isPackaged;
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL ?? "http://localhost:5173";

const SEARCH_BLOCK_SIGNS = ["detected unusual traffic", "/sorry/index", "recaptcha"];
// A stuck page load (no network, a hung redirect, ...) has no built-in
// ceiling otherwise — the backend's own wait for this result is bounded, but
// leaving this side unbounded would leak a hidden window forever on top of
// that timeout firing anyway.
const SEARCH_TIMEOUT_MS = 15000;

/** The backend has no browser of its own, so it asks this (already-open)
 *  desktop app to do the actual looking-up — this is that work, run in a
 *  hidden window. Gold-price queries go straight to a page that serves its
 *  live price to anyone; anything else is a best-effort Google search that
 *  stays honest when the search engine blocks it, rather than fighting that
 *  block by disguising the automation. */
async function runWebSearchInner(query: string): Promise<{ resultText?: string; error?: string }> {
  const isGoldPrice = /\bgold\b/i.test(query) && /\b(price|worth|cost|value)\b/i.test(query);
  // A separate (non-default) session partition — the packaged app's CSP
  // rewrite below is scoped to `session.defaultSession`, which this window
  // would otherwise share; Google/goldprice.org's own scripts need their own
  // unmodified headers, not our app's restrictive self-only CSP.
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, partition: "web-search-scratch" },
  });
  try {
    if (isGoldPrice) {
      await win.loadURL("https://goldprice.org/");
      // The page renders "NaN" until its live feed populates a few seconds in.
      await win.webContents.executeJavaScript(`
        new Promise((resolve) => {
          const deadline = Date.now() + 10000;
          (function check() {
            const text = document.body.innerText;
            const idx = text.indexOf("Gold Price per Ounce:");
            const chunk = idx === -1 ? "" : text.slice(idx, idx + 60);
            if ((idx !== -1 && !chunk.includes("NaN")) || Date.now() > deadline) return resolve(undefined);
            setTimeout(check, 300);
          })();
        })
      `);
      const bodyText: string = await win.webContents.executeJavaScript("document.body.innerText");
      const match = bodyText.match(/Gold Price per Ounce:\s*([\d,.]+)\s*([-+][\d,.]+)/);
      if (!match) return { error: "Could not read a live gold price" };
      const asOf = bodyText.match(/\b\w+ \d{1,2}(?:st|nd|rd|th) \d{4}, [\d:apm\s]+NY time/i)?.[0];
      return {
        resultText: `Gold price per ounce: $${match[1]} (change ${match[2]})${asOf ? ` as of ${asOf}` : ""}.`,
      };
    }

    await win.loadURL(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
    const bodyText: string = await win.webContents.executeJavaScript(
      `(document.querySelector("#search")?.innerText ?? document.body.innerText).slice(0, 3000)`
    );
    if (SEARCH_BLOCK_SIGNS.some((sign) => bodyText.toLowerCase().includes(sign))) {
      return { error: "Search engine blocked the automated request" };
    }
    return { resultText: bodyText };
  } finally {
    win.destroy();
  }
}

async function runWebSearch(query: string): Promise<{ resultText?: string; error?: string }> {
  return Promise.race([
    runWebSearchInner(query),
    new Promise<{ error: string }>((resolve) =>
      setTimeout(() => resolve({ error: "Search timed out" }), SEARCH_TIMEOUT_MS)
    ),
  ]);
}

ipcMain.handle("web-search", async (_event, query: unknown) => {
  if (typeof query !== "string" || !query.trim()) return { error: "No search query provided" };
  try {
    return await runWebSearch(query.trim());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Web search failed" };
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0b0d12",
    title: "Personal Automation Agent",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Restrictive CSP for the packaged app. Skipped in dev: Vite's dev server
  // relies on eval-based HMR that a strict CSP would otherwise have to
  // special-case, and dev only ever talks to localhost anyway.
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self' http://localhost:4000 ws://localhost:4000; " +
              "script-src 'self'; " +
              "style-src 'self' 'unsafe-inline'; " +
              "connect-src 'self' http://localhost:4000 ws://localhost:4000; " +
              "img-src 'self' data:;",
          ],
        },
      });
    });
  }

  if (isDev) {
    void win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  // Electron denies getUserMedia (mic) by default unless a permission request
  // handler explicitly allows it — needed for the voice orb's Agora/Web Speech
  // capture. The OS-level mic privacy prompt (macOS) still applies on top of
  // this. `session.defaultSession` throws until the app is ready, so this has
  // to live here rather than at module scope.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
