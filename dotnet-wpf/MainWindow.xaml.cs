using Microsoft.Web.WebView2.Core;
using System;
using System.Diagnostics;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;

namespace WebCapture
{
    public partial class MainWindow : Window
    {
    // Default web start URL for the embedded WebView. You can override with the
    // environment variable `WEB_START_URL` (for example in development).
    // By default we point to the deployed frontend so the Windows app loads the hosted UI.
    private string startUrl = Environment.GetEnvironmentVariable("WEB_START_URL") ?? "https://remote-web-omega.vercel.app/";
    // Default signaling host used by the page. You can override via `SIGNALING_URL` env var.
    private string signalingUrl = Environment.GetEnvironmentVariable("SIGNALING_URL") ?? "ws://localhost:3001";
        private TranscriptionService _transcriber;
        public MainWindow()
        {
            InitializeComponent();
            InitializeAsync();
        }

        private async void InitializeAsync()
        {
            try
            {
                await WebView.EnsureCoreWebView2Async();
                // Navigate to the frontend. If the page needs a signaling override (for example to
                // talk to a local `server.js` while the site is hosted remotely), we append the
                // `signaling` query parameter so the client will use the provided WebSocket URL.
                // Build the navigate URL carefully to preserve existing query params.
                var nav = startUrl;
                try
                {
                    var uri = new Uri(startUrl);
                    var qp = System.Web.HttpUtility.ParseQueryString(uri.Query);
                    // only set signaling param if it's not already present
                    if (string.IsNullOrWhiteSpace(qp.Get("signaling")) && string.IsNullOrWhiteSpace(qp.Get("signalingUrl")))
                    {
                        qp.Set("signaling", signalingUrl);
                        var ub = new UriBuilder(uri) { Query = qp.ToString() };
                        nav = ub.ToString();
                    }
                }
                catch
                {
                    // fallback: naive append
                    if (!startUrl.Contains("?")) nav = startUrl + "?signaling=" + signalingUrl;
                    else nav = startUrl + "&signaling=" + signalingUrl;
                }

                WebView.CoreWebView2.Navigate(nav);
                WebView.CoreWebView2.NavigationCompleted += CoreWebView2_NavigationCompleted;
            }
            catch (Exception ex)
            {
                MessageBox.Show("WebView2 initialization failed: " + ex.Message);
            }
        }

        private void CoreWebView2_NavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            // Page loaded; you can call JS functions on it.
        }

        private async void StartBtn_Click(object sender, RoutedEventArgs e)
        {
            // Trigger the page's startCapture (if it's present). This provides the "click" user gesture context.
            try
            {
                StatusText.Text = "Starting capture...";
                // Execute JS to call the in-page start if available
                await WebView.CoreWebView2.ExecuteScriptAsync("(function(){ if(window.webScreenCapture && window.webScreenCapture.startCapture) { window.webScreenCapture.startCapture(); return true; } return false; })();");

                // Start native transcription (Azure) if configured
                var key = Environment.GetEnvironmentVariable("SPEECH_KEY");
                var region = Environment.GetEnvironmentVariable("SPEECH_REGION");
                if (!string.IsNullOrWhiteSpace(key) && !string.IsNullOrWhiteSpace(region))
                {
                    try
                    {
                        _transcriber = new TranscriptionService(key, region);
                        _transcriber.OnTranscription += Transcriber_OnTranscription;
                        await _transcriber.StartAsync();
                        StatusText.Text = "Capturing + Transcribing";
                    }
                    catch (Exception ex)
                    {
                        StatusText.Text = "Capturing (transcription failed)";
                        MessageBox.Show("Transcription start failed: " + ex.Message);
                    }
                }
                else
                {
                    StatusText.Text = "Capturing (no transcription configured)";
                }

                StartBtn.IsEnabled = false;
                StopBtn.IsEnabled = true;
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to start capture: " + ex.Message);
                StatusText.Text = "Error";
            }
        }

        private async void StopBtn_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                await WebView.CoreWebView2.ExecuteScriptAsync("(function(){ if(window.webScreenCapture && window.webScreenCapture.stopCapture) { window.webScreenCapture.stopCapture(); return true; } return false; })();");
                // Stop native transcription if running
                try
                {
                    if (_transcriber != null)
                    {
                        await _transcriber.StopAsync();
                        _transcriber.OnTranscription -= Transcriber_OnTranscription;
                        _transcriber.Dispose();
                        _transcriber = null;
                    }
                }
                catch { }

                StartBtn.IsEnabled = true;
                StopBtn.IsEnabled = false;
                StatusText.Text = "Stopped";
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to stop capture: " + ex.Message);
            }
        }

        private async void Transcriber_OnTranscription(object sender, TranscriptionEventArgs e)
        {
            try
            {
                // Forward transcript to the embedded page's addSubtitle(text, confidence, isFinal)
                var safeText = JsonSerializer.Serialize(e.Text);
                var js = $"(function(){{ try {{ if(window.webScreenCapture && window.webScreenCapture.addSubtitle) window.webScreenCapture.addSubtitle({safeText}, {e.Confidence.ToString(System.Globalization.CultureInfo.InvariantCulture)}, {e.IsFinal.ToString().ToLower()}); }} catch(e){{}} }})();";
                if (WebView?.CoreWebView2 != null)
                {
                    await WebView.CoreWebView2.ExecuteScriptAsync(js);
                }
            }
            catch { }
        }

        private async void CopyLinkBtn_Click(object sender, RoutedEventArgs e)
        {
            // Ask the page to generate a share link and then read the input value via JS
            try
            {
                // Call the page function to generate and populate the share URL input
                await WebView.CoreWebView2.ExecuteScriptAsync("(function(){ if(window.webScreenCapture && window.webScreenCapture.generateShareLink) { window.webScreenCapture.generateShareLink(); return true; } return false; })();");
                // Read the shareUrl input value
                var result = await WebView.CoreWebView2.ExecuteScriptAsync("(function(){ var el = document.getElementById('shareUrl'); return el ? el.value : ''; })();");
                // ExecuteScriptAsync returns a JSON string; trim quotes
                var shareUrl = JsonSerializer.Deserialize<string>(result);
                if (!string.IsNullOrWhiteSpace(shareUrl))
                {
                    Clipboard.SetText(shareUrl);
                    StatusText.Text = "Share link copied to clipboard";
                    // Optionally open default browser to view the link
                    // Process.Start(new ProcessStartInfo(shareUrl) { UseShellExecute = true });
                }
                else
                {
                    MessageBox.Show("Share URL not available. Make sure you started capture or generated the link.");
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to copy share link: " + ex.Message);
            }
        }
    }
}
