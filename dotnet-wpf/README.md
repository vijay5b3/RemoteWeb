# WebCapture WPF Host (scaffold)

This is a minimal WPF (.NET 7) scaffold that embeds your existing web app in a WebView2 control and provides native Start/Stop/Copy Share Link buttons.

What it does
- Hosts your existing web UI in WebView2 (points to http://localhost:3001 by default).
- When you click Start Capture in the native app, it calls the in-page function `window.webScreenCapture.startCapture()` (so the web code still handles media and signaling).
- When you click "Copy Share Link" it calls `generateShareLink()` in the page and copies the resulting input value to the clipboard.

Prerequisites
- .NET 7 SDK installed
- Visual Studio 2022+ (or `dotnet` CLI)
- WebView2 runtime installed (Microsoft Edge WebView2 Runtime)
- Start the signaling server in your project root first:

```powershell
cd "C:\Users\Vijay Kumar Bobbadi\Downloads\Web to Web Remote"
# start the signaling server
npm start
```

Run the WPF app

```powershell
cd "C:\Users\Vijay Kumar Bobbadi\Downloads\Web to Web Remote\dotnet-wpf"
# build and run
dotnet run
```

Notes & next steps
- This scaffold calls into the web page to start/stop capture. That keeps most logic in the browser code while giving you a native wrapper that persists capture even when minimized.
- Next steps if you want a fully native capture inside the exe:
  - Replace the in-page capture calls with native capture implemented in C# using Windows Graphics Capture (WinRT) and feed frames into a native WebRTC library (MixedReality.WebRTC).
  - Add loopback audio capture for system audio (WASAPI / NAudio).
  - Optionally spawn `server.js` automatically from the app so the exe is self-contained.

If you want, I can now:
- Implement native Windows Graphics Capture integration (frame producer) and a POC that writes frames to disk.
- Integrate MixedReality.WebRTC to push the captured frames to viewers (requires more setup).
- Make the exe also launch the signaling server automatically.

Tell me which next step you prefer and I'll implement it in the repo.
