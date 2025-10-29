using System;
using System.Threading.Tasks;
using Microsoft.CognitiveServices.Speech;
using Microsoft.CognitiveServices.Speech.Audio;

namespace WebCapture
{
    public class TranscriptionEventArgs : EventArgs
    {
        public string Text { get; set; } = string.Empty;
        public bool IsFinal { get; set; }
        public double Confidence { get; set; }
    }

    public class TranscriptionService : IDisposable
    {
        private SpeechRecognizer _recognizer;
        private SpeechConfig _config;

        public event EventHandler<TranscriptionEventArgs> OnTranscription;

        public TranscriptionService(string subscriptionKey, string region)
        {
            if (string.IsNullOrWhiteSpace(subscriptionKey) || string.IsNullOrWhiteSpace(region))
                throw new ArgumentException("Speech key and region must be provided");

            _config = SpeechConfig.FromSubscription(subscriptionKey, region);
            _config.SpeechRecognitionLanguage = "en-US";
            // enable interim results
            _config.SetProperty("SPEECH-EnableInterimResult", "true");
        }

        public async Task StartAsync()
        {
            if (_recognizer != null) return;

            var audioConfig = AudioConfig.FromDefaultMicrophoneInput();
            _recognizer = new SpeechRecognizer(_config, audioConfig);

            _recognizer.Recognizing += (s, e) => {
                var text = e.Result.Text;
                if (!string.IsNullOrEmpty(text))
                {
                    OnTranscription?.Invoke(this, new TranscriptionEventArgs { Text = text, IsFinal = false, Confidence = 0 });
                }
            };

            _recognizer.Recognized += (s, e) => {
                var text = e.Result.Text;
                // The Speech SDK result does not expose a direct confidence property here; set to 0.
                var conf = 0.0;
                if (!string.IsNullOrEmpty(text))
                {
                    OnTranscription?.Invoke(this, new TranscriptionEventArgs { Text = text, IsFinal = true, Confidence = conf });
                }
            };

            _recognizer.Canceled += (s, e) => {
                // propagate as final empty or informational
            };

            await _recognizer.StartContinuousRecognitionAsync().ConfigureAwait(false);
        }

        public async Task StopAsync()
        {
            if (_recognizer == null) return;
            await _recognizer.StopContinuousRecognitionAsync().ConfigureAwait(false);
            _recognizer.Dispose();
            _recognizer = null;
        }

        public void Dispose()
        {
            try { _recognizer?.Dispose(); } catch { }
        }
    }
}
