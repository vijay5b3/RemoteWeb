const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: false
    }
  });

  // Load the localhost signaling/static server. Ensure you run `node server.js` first.
  const url = process.env.ELECTRON_START_URL || 'http://localhost:3001';
  win.loadURL(url);

  // Optional: open devtools when NODE_ENV=development
  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  // On Windows it's common for apps to quit when all windows are closed
  if (process.platform !== 'darwin') app.quit();
});
