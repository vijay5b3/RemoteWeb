class WebScreenCapture {
    constructor() {
        // DOM
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.fullscreenBtn = document.getElementById('fullscreenBtn');
    this.presenterBtn = document.getElementById('presenterBtn');
        this.preview = document.getElementById('preview');
        this.statusEl = document.getElementById('status');
        this.systemAudioCheckbox = document.getElementById('systemAudio');
        this.subtitlesCheckbox = document.getElementById('enableSubtitles');
        this.subtitlesContainer = document.getElementById('subtitlesContainer');
        this.generateShareBtn = document.getElementById('generateShare');
        this.shareUrlInput = document.getElementById('shareUrl');

        this.mediaStream = null;
        this.microphoneStream = null;
        this.speechRecognition = null;
        this.isCapturing = false;
        this.isSpeechRecognitionActive = false;
    this.isPresenter = new URLSearchParams(window.location.search).get('presenter') === '1';
    this.isElectron = navigator.userAgent.toLowerCase().includes('electron');
        // WebRTC / signaling
        // Allow overriding the signaling URL via query parameter `signaling` or `signalingUrl`.
        // Examples:
        //  ?signaling=ws://localhost:3001
        //  ?signaling=wss://signaler.example.com:443
        const params = new URLSearchParams(window.location.search);
        const signalingParam = params.get('signaling') || params.get('signalingUrl');
        const normalize = (s) => {
            if (!s) return null;
            // if it already contains ws:// or wss://, return as-is
            if (/^wss?:\/\//i.test(s)) return s;
            // otherwise assume ws and prepend scheme
            return (location.protocol === 'https:' ? 'wss://' : 'ws://') + s;
        };
        if (signalingParam) {
            this.signalingUrl = normalize(signalingParam);
        } else {
            // Prefer explicit hostname so we don't accidentally append extra ports to location.host
            this.signalingUrl = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
                ? 'ws://localhost:3001'
                : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.hostname + ':3001';
        }
    this.signalingSocket = null;
    this.peerConnections = new Map(); // viewerId -> RTCPeerConnection (host)
    this.dataChannels = new Map(); // viewerId -> RTCDataChannel (host)
    this.remoteStream = null; // viewer receives into this

        this.bind();
        this.detectViewerMode();
    }

    bind() {
        this.startBtn.addEventListener('click', () => this.startCapture());
        this.stopBtn.addEventListener('click', () => this.stopCapture());
        this.fullscreenBtn.addEventListener('click', () => this.enterFullscreen());
        this.generateShareBtn.addEventListener('click', () => this.generateShareLink());
    this.copyShareBtn = document.getElementById('copyShare');
    if (this.copyShareBtn) this.copyShareBtn.addEventListener('click', () => this.copyShareUrl());
    this.closeSubtitlesBtn = document.getElementById('closeSubtitles');
    if (this.closeSubtitlesBtn) this.closeSubtitlesBtn.addEventListener('click', () => this.toggleSubtitles());
        if (this.presenterBtn) {
            // enable presenter button and open a minimal presenter window
            this.presenterBtn.disabled = false;
            this.presenterBtn.addEventListener('click', () => this.openPresenterWindow());
        }
    }

    openPresenterWindow() {
        // open a minimal popup that can be shared instead of the main UI
        const room = this.roomId || this.generateRoomId();
        this.roomId = room;
        const url = window.location.origin + window.location.pathname.replace(/index.html$/, 'presenter.html') + '?presenter=1&room=' + room;
        const name = 'presenter-' + room;
        const features = 'toolbar=0,location=0,menubar=0,status=0,resizable=1,width=1000,height=700';
        try {
            const w = window.open(url, name, features);
            if (w) w.focus();
            this.addSubtitleInfo('Presenter window opened. In the presenter window click "Start Screen Capture" and then share that window in the OS screen sharing dialog.', 'info');
            // ensure signaling is available for this room as host
            if (!this.signalingSocket || this.signalingSocket.readyState !== WebSocket.OPEN) this.connectSignaling();
        } catch (e) {
            this.addSubtitleInfo('Failed to open presenter window: ' + (e.message || e), 'error');
        }
    }

    async startCapture() {
        try {
            const displayMediaOptions = {
                video: { cursor: 'always', displaySurface: 'monitor' },
                audio: this.systemAudioCheckbox.checked
            };

            if (this.isElectron) {
                try {
                    this.mediaStream = await this.getElectronScreenStream();
                } catch (e) {
                    console.warn('Electron capture failed, falling back to getDisplayMedia', e);
                    this.mediaStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
                }
            } else {
                this.mediaStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
            }
            this.preview.srcObject = this.mediaStream;
            this.isCapturing = true;
            this.updateUIOnStart();

            // If this window is the presenter window, enter fullscreen to keep UI out of the capture.
            if (this.isPresenter) {
                try { this.enterFullscreen(); } catch (e) { /* ignore */ }
            }

            await this.initializeAudioForSubtitles();

            // If host mode (no room param), create or reuse a room and connect to signaling
            if (!this.roomId) {
                // generate ephemeral room shown in share link
                this.roomId = new URLSearchParams(window.location.search).get('room') || this.generateRoomId();
                // update share input
                this.shareUrlInput.value = window.location.origin + window.location.pathname + '?room=' + this.roomId;
            }

            this.connectSignaling();

            if (this.subtitlesCheckbox.checked) {
                this.startSpeechRecognition();
            }

            // Auto stop on end if user stops sharing via browser UI
            const tracks = this.mediaStream.getTracks();
            tracks.forEach(t => t.addEventListener('ended', () => this.stopCapture()));
        } catch (err) {
            this.showError('Failed to start screen capture: ' + (err.message || err.name));
        }
    }

    stopCapture() {
        this.isCapturing = false;
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(t => t.stop());
            this.mediaStream = null;
        }
        if (this.microphoneStream) {
            this.microphoneStream.getTracks().forEach(t => t.stop());
            this.microphoneStream = null;
        }
        this.preview.srcObject = null;
        this.stopSpeechRecognition();
        this.updateUIOnStop();
        this.addSubtitleInfo('Stopped capturing', 'info');
    }

    updateUIOnStart() {
        this.startBtn.disabled = true;
        this.stopBtn.disabled = false;
        this.fullscreenBtn.disabled = false;
        this.statusEl.textContent = 'Capturing';
    }

    updateUIOnStop() {
        this.startBtn.disabled = false;
        this.stopBtn.disabled = true;
        this.fullscreenBtn.disabled = true;
        this.statusEl.textContent = 'Ready';
    }

    async initializeAudioForSubtitles() {
        const screenAudioTracks = this.mediaStream?.getAudioTracks() || [];
        if (screenAudioTracks.length > 0) {
            this.addSubtitleInfo('✅ Using system audio from screen capture', 'success');
            this.audioSource = 'system';
            return true;
        }

        this.addSubtitleInfo('⚠️ No system audio detected. Using microphone for subtitles.', 'warning');
        this.audioSource = 'microphone';

        try {
            this.microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            return true;
        } catch (err) {
            this.addSubtitleInfo('❌ Microphone access denied. Subtitles unavailable.', 'error');
            return false;
        }
    }

    setupSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const SpeechGrammarList = window.SpeechGrammarList || window.webkitSpeechGrammarList;
        if (!SpeechRecognition) {
            this.addSubtitleInfo('Speech Recognition API not supported in this browser.', 'warning');
            this.subtitlesCheckbox.disabled = true;
            return false;
        }

        this.speechRecognition = new SpeechRecognition();
        if (SpeechGrammarList) {
            try {
                const grammar = '#JSGF V1.0; grammar technical; public <technical> = screen capture | audio | video | browser | application | microphone | system | recording | sharing | fullscreen;';
                const list = new SpeechGrammarList();
                list.addFromString(grammar, 1);
                this.speechRecognition.grammars = list;
            } catch (e) {
                // ignore
            }
        }

        this.speechRecognition.continuous = true;
        this.speechRecognition.interimResults = true;
        this.speechRecognition.maxAlternatives = 3;
        this.speechRecognition.lang = 'en-US';

    // throttle settings for interim transcript forwarding (ms)
    this._interimThrottleMS = 150;
    this._lastInterimSentAt = 0;
    this._lastInterimText = '';

        this.speechRecognition.onresult = (e) => this.handleSpeechResult(e);
        this.speechRecognition.onerror = (e) => this.handleSpeechError(e);
        this.speechRecognition.onend = () => {
            this.isSpeechRecognitionActive = false;
            if (this.subtitlesCheckbox.checked && this.isCapturing) {
                // restart after short delay
                setTimeout(() => this.startSpeechRecognition(), 500);
            }
        };

        return true;
    }

    /* -------------------- Signaling and WebRTC -------------------- */
    connectSignaling() {
        if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) return;
        try {
            this.signalingSocket = new WebSocket(this.signalingUrl);
        } catch (e) {
            console.warn('Signaling connection failed', e);
            return;
        }

        this.signalingSocket.addEventListener('open', () => {
            // Determine role: if URL has ?room and this page isn't currently capturing, act as viewer.
            const params = new URLSearchParams(window.location.search);
            const roomFromUrl = params.get('room');
            const isViewerByUrl = !!roomFromUrl && !this.isCapturing;
            this.role = isViewerByUrl ? 'viewer' : 'host';
            this.roomId = this.roomId || roomFromUrl || this.generateRoomId();
            console.log('[signaling] connected, joining room', this.roomId, 'as', this.role);
            this.addSubtitleInfo(`Signaling: connected as ${this.role}`, 'info');
            this.sendSignaling({ type: 'join', room: this.roomId, role: this.role });
        });

        this.signalingSocket.addEventListener('message', (ev) => {
            let msg = {};
            try { msg = JSON.parse(ev.data); } catch (e) { return; }
            console.log('[signaling] recv', msg);
            this.handleSignalingMessage(msg);
        });

        this.signalingSocket.addEventListener('close', () => {
            // cleanup
        });
    }

    sendSignaling(obj) {
        if (!this.signalingSocket || this.signalingSocket.readyState !== WebSocket.OPEN) return;
        console.log('[signaling] send', obj);
        this.signalingSocket.send(JSON.stringify(obj));
    }

    async handleSignalingMessage(msg) {
        const { type } = msg;
        if (type === 'joined') {
            // joined acknowledgement
            console.log('[signaling] joined ack', msg.id);
            this.addSubtitleInfo('Signaling: joined room ' + this.roomId, 'info');
            return;
        }

        if (type === 'viewer-joined' && this.isCapturing) {
            // a viewer connected, create a peer for them
            const viewerId = msg.viewerId;
            console.log('[signaling] viewer-joined', viewerId);
            this.addSubtitleInfo('Viewer joined: ' + viewerId, 'info');
            this.createPeerForViewer(viewerId);
            return;
        }

        if (type === 'offer') {
            // viewer receives offer (should be only in future extensions). In our flow, host sends offers.
        }

        if (type === 'offer' && this.role === 'viewer') {
            // viewer: set remote desc and answer
            const from = msg.from;
            const offer = msg.payload;
            console.log('[signaling] received offer from', from);
            await this.ensureRemotePeer();
            await this.remotePc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await this.remotePc.createAnswer();
            await this.remotePc.setLocalDescription(answer);
            console.log('[signaling] sending answer to', from);
            this.sendSignaling({ type: 'answer', room: this.roomId, target: from, payload: this.remotePc.localDescription });
            return;
        }

        if (type === 'answer' && this.isCapturing) {
            // host receives answer from viewer
            const from = msg.from;
            const payload = msg.payload;
            console.log('[signaling] received answer from', from);
            const pc = this.peerConnections.get(from);
            if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(payload));
            }
            return;
        }

        if (type === 'candidate') {
            const from = msg.from;
            const payload = msg.payload;
            console.log('[signaling] received candidate from', from, payload ? (payload.candidate || '[obj]') : '[null]');
            if (this.role === 'viewer' && this.remotePc) {
                try { await this.remotePc.addIceCandidate(payload); } catch (e) {}
            } else if (this.isCapturing) {
                const pc = this.peerConnections.get(from);
                if (pc) try { await pc.addIceCandidate(payload); } catch (e) {}
            }
            return;
        }

        if (type === 'host-left') {
            this.addSubtitleInfo('Host has ended the stream', 'info');
        }
    }

    async createPeerForViewer(viewerId) {
        // create RTCPeerConnection for a viewer and send an offer
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        this.peerConnections.set(viewerId, pc);

        // create a data channel for subtitles
        try {
            const dc = pc.createDataChannel('subtitles');
            this.dataChannels.set(viewerId, dc);
            dc.onopen = () => console.log('[subtitles] datachannel open for', viewerId);
            dc.onclose = () => console.log('[subtitles] datachannel closed for', viewerId);
        } catch (e) {
            console.warn('Failed to create datachannel', e);
        }

        // add tracks
        try {
            const stream = this.mediaStream;
            if (stream) {
                for (const track of stream.getTracks()) pc.addTrack(track, stream);
            }
        } catch (e) {}

        pc.onicecandidate = (ev) => {
            if (ev.candidate) {
                this.sendSignaling({ type: 'candidate', room: this.roomId, target: viewerId, payload: ev.candidate });
            }
        };

        // when data channel from host side is negotiated, nothing else needed here; viewer handles ondatachannel

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.sendSignaling({ type: 'offer', room: this.roomId, target: viewerId, payload: pc.localDescription });
    }

    async ensureRemotePeer() {
        if (this.remotePc) return;
        this.remotePc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        this.remoteStream = new MediaStream();
        this.remotePc.ontrack = (ev) => {
            ev.streams[0]?.getTracks().forEach(t => this.remoteStream.addTrack(t));
            // attach to preview for viewer
            this.preview.srcObject = this.remoteStream;
        };
        // receive data channel for subtitles from host
        this.remotePc.ondatachannel = (ev) => {
            try {
                const ch = ev.channel;
                console.log('[subtitles] viewer got datachannel', ch.label);
                ch.onmessage = (mev) => {
                    try {
                        const obj = JSON.parse(mev.data);
                        if (obj && obj.text) this.addSubtitle(obj.text, obj.confidence || 0, obj.isFinal || false);
                    } catch (e) {
                        // ignore
                    }
                };
            } catch (e) { }
        };
        this.remotePc.onicecandidate = (ev) => {
            if (ev.candidate) this.sendSignaling({ type: 'candidate', room: this.roomId, target: null, payload: ev.candidate });
        };
    }


    startSpeechRecognition() {
        if (!this.speechRecognition) {
            if (!this.setupSpeechRecognition()) return;
        }

        try {
            this.speechRecognition.start();
            this.isSpeechRecognitionActive = true;
            this.addSubtitleInfo('Speech recognition started', 'info');
        } catch (err) {
            // already started or invalid state
        }
    }

    stopSpeechRecognition() {
        if (this.speechRecognition && this.isSpeechRecognitionActive) {
            try { this.speechRecognition.stop(); } catch (e) { }
        }
        this.isSpeechRecognitionActive = false;
    }

    async getElectronScreenStream() {
        // Runs in Electron renderer with nodeIntegration enabled.
        // Use desktopCapturer to pick a source and then request a MediaStream via getUserMedia.
        try {
            const { desktopCapturer } = window.require('electron');
            const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
            // Prefer a full screen source
            let source = sources.find(s => s.name && s.name.toLowerCase().includes('screen')) || sources[0];
            if (!source) throw new Error('No desktop sources');

            const constraints = {
                audio: this.systemAudioCheckbox.checked ? {
                    mandatory: { chromeMediaSource: 'desktop' }
                } : false,
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: source.id,
                        maxWidth: 3840,
                        maxHeight: 2160
                    }
                }
            };

            return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
            throw e;
        }
    }

    handleSpeechError(event) {
        const err = event.error;
        console.warn('Speech recognition error', err);
        switch (err) {
            case 'no-speech':
                setTimeout(() => { if (this.subtitlesCheckbox.checked && this.isCapturing) this.startSpeechRecognition(); }, 2000);
                break;
            case 'audio-capture':
                this.addSubtitleInfo('Audio capture failed. Switching to microphone.', 'warning');
                this.fallbackToMicrophone();
                break;
            case 'network':
                // retry with backoff
                this.retryCount = (this.retryCount || 0) + 1;
                const delay = Math.min(1000 * Math.pow(2, this.retryCount), 10000);
                setTimeout(() => this.startSpeechRecognition(), delay);
                break;
            default:
                break;
        }
    }

    handleSpeechResult(event) {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            // pick best alternative
            let bestAlt = result[0];
            for (let j = 1; j < result.length; j++) {
                if ((result[j].confidence || 0) > (bestAlt.confidence || 0)) bestAlt = result[j];
            }

            const transcript = bestAlt.transcript || '';
            const confidence = bestAlt.confidence || 0;

            if (result.isFinal) {
                if (confidence > 0.7 || transcript.length > 10) {
                    const enhanced = this.enhanceTranscript(transcript);
                    this.addSubtitle(enhanced, confidence, true);
                }
            } else {
                interimTranscript += transcript;
                this.updateSubtitlesStatus(`🎤 ${interimTranscript}...`);

                // Forward interim transcripts to viewers (throttled)
                const now = Date.now();
                const normalized = interimTranscript.trim();
                if (normalized && (normalized !== this._lastInterimText) && (now - this._lastInterimSentAt > this._interimThrottleMS)) {
                    this._lastInterimText = normalized;
                    this._lastInterimSentAt = now;
                    // send interim payload
                    const payload = JSON.stringify({ text: this.enhanceTranscript(normalized), confidence: 0, isFinal: false, ts: now });
                    for (const [viewerId, dc] of this.dataChannels) {
                        try { if (dc && dc.readyState === 'open') dc.send(payload); } catch (e) { }
                    }
                }
            }
        }
    }

    enhanceTranscript(text) {
        return text
            .trim()
            .replace(/\b(um|uh|ah)\b/gi, '')
            .replace(/\s+/g, ' ')
            .replace(/^./, ch => ch.toUpperCase());
    }

    addSubtitle(text, confidence = 0, isFinal = false) {
        // If this is an interim (not final) subtitle, update a single interim element instead of adding many entries.
        try {
            if (!isFinal) {
                let interim = this.subtitlesContainer.querySelector('.subtitle.interim');
                if (!interim) {
                    interim = document.createElement('div');
                    interim.className = 'subtitle interim';
                    // put interim on top
                    this.subtitlesContainer.prepend(interim);
                }
                interim.textContent = text; // don't append confidence for interim
                // keep history limited
                while (this.subtitlesContainer.childElementCount > 60) this.subtitlesContainer.removeChild(this.subtitlesContainer.lastChild);
                return;
            }

            // Final subtitle: remove any interim element and prepend the final text
            const existingInterim = this.subtitlesContainer.querySelector('.subtitle.interim');
            if (existingInterim) existingInterim.remove();

            const el = document.createElement('div');
            el.className = 'subtitle final';
            el.textContent = text + (confidence ? ` (${Math.round(confidence*100)}%)` : '');
            this.subtitlesContainer.prepend(el);
            // limit history
            while (this.subtitlesContainer.childElementCount > 40) this.subtitlesContainer.removeChild(this.subtitlesContainer.lastChild);
        } finally {
            // If this client is the host, forward final subtitles to connected viewers via data channels
            try {
                if (this.isCapturing && isFinal) {
                    const payload = JSON.stringify({ text, confidence, isFinal, ts: Date.now() });
                    for (const [viewerId, dc] of this.dataChannels) {
                        try { if (dc && dc.readyState === 'open') dc.send(payload); } catch (e) { /* ignore individual send errors */ }
                    }
                }
            } catch (e) {}
        }
    }

    updateSubtitlesStatus(text) {
        // show temporary message in container
        let temp = this.subtitlesContainer.querySelector('.temp-status');
        if (!temp) {
            temp = document.createElement('div');
            temp.className = 'subtitle temp-status';
            this.subtitlesContainer.prepend(temp);
        }
        temp.textContent = text;
    }

    addSubtitleInfo(msg, level = 'info') {
        this.statusEl.textContent = msg;
        // also add to subtitles for history
        const el = document.createElement('div');
        el.className = 'subtitle';
        el.textContent = msg;
        this.subtitlesContainer.prepend(el);
    }

    async fallbackToMicrophone() {
        try {
            this.microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.addSubtitleInfo('Microphone acquired for subtitles.', 'info');
        } catch (err) {
            this.addSubtitleInfo('Microphone unavailable. Subtitles disabled.', 'error');
            this.subtitlesCheckbox.checked = false;
        }
    }

    enterFullscreen() {
        const el = document.documentElement;
        if (el.requestFullscreen) {
            el.requestFullscreen();
            document.body.classList.add('fullscreen-active');
        } else if (el.webkitRequestFullscreen) {
            el.webkitRequestFullscreen();
            document.body.classList.add('fullscreen-active');
        }
    }

    generateRoomId() {
        return 'r-' + Math.random().toString(36).slice(2, 9) + '-' + Date.now().toString(36);
    }

    generateShareLink() {
        // If we're already hosting a room, reuse that room id so viewers join the same session
        const room = this.roomId || this.generateRoomId();
        // ensure we remember the chosen roomId
        this.roomId = room;
        const base = window.location.origin + window.location.pathname;
        const url = `${base}?room=${room}`;
        this.shareUrlInput.value = url;
        try { navigator.clipboard?.writeText(url); } catch (e) {}
        this.addSubtitleInfo('Share link generated and copied to clipboard: ' + room, 'info');
        // If not already connected to signaling, connect so host is present in that room
        if (!this.signalingSocket || this.signalingSocket.readyState !== WebSocket.OPEN) this.connectSignaling();
    }

    copyShareUrl() {
        try {
            const url = this.shareUrlInput.value;
            if (url) {
                try { navigator.clipboard.writeText(url); this.addSubtitleInfo('Share URL copied to clipboard', 'info'); } catch (e) {
                    // fallback
                    this.shareUrlInput.select(); document.execCommand('copy'); this.addSubtitleInfo('Share URL copied (fallback)', 'info');
                }
            } else {
                this.addSubtitleInfo('No share URL to copy', 'warning');
            }
        } catch (e) { }
    }

    toggleSubtitles() {
        const panel = document.getElementById('subtitlesPanel');
        if (!panel) return;
        if (panel.style.display === 'none') {
            panel.style.display = '';
            this.addSubtitleInfo('Subtitles shown', 'info');
        } else {
            panel.style.display = 'none';
            this.addSubtitleInfo('Subtitles hidden', 'info');
        }
    }

    detectViewerMode() {
        const params = new URLSearchParams(window.location.search);
        const room = params.get('room');
        if (room) {
            // viewer mode
            const controls = document.querySelector('.controls-section');
            if (controls) controls.style.display = 'none';
            const title = document.getElementById('title');
            if (title) title.textContent = 'Screen Viewer';
            this.addSubtitleInfo('Viewer mode: waiting for host to stream', 'info');
            // auto-connect signaling for viewer so host will be notified
            this.roomId = room;
            this.connectSignaling();
            // apply viewer-mode styling to expand preview area
            document.body.classList.add('viewer-mode');
        }
    }
}

// Initialize when DOM ready
window.addEventListener('DOMContentLoaded', () => {
    window.webScreenCapture = new WebScreenCapture();
});
