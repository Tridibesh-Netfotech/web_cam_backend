import React, {
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
  useCallback,
} from "react";

const WebCamRecorder = forwardRef((props, ref) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const wsRef = useRef(null);

  const [isRecording, setIsRecording] = useState(false);
  const [connected, setConnected] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [history, setHistory] = useState([]);
  const [status, setStatus] = useState("idle");
  const [autoRecordOnQuestion, setAutoRecordOnQuestion] = useState(true);

  const uploadUrl =
    window.REACT_APP_UPLOAD_URL || "http://127.0.0.1:8000/save-recording/";
  const wsUrl = window.REACT_APP_WS_URL || "ws://127.0.0.1:8000/questions";
  const candidateId = window.REACT_APP_CANDIDATE_ID || "candidate_123";

  // ✅ Initialize camera
  useEffect(() => {
    let mounted = true;
    async function initCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (!mounted) return;
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;

        mediaRecorderRef.current = new MediaRecorder(stream, {
          mimeType: "video/webm;codecs=vp9,opus",
        });

        mediaRecorderRef.current.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };

        mediaRecorderRef.current.onstop = async () => {
          if (!chunksRef.current.length) return;

          const blob = new Blob(chunksRef.current, { type: "video/webm" });
          chunksRef.current = [];

          const ts = new Date().toISOString().replace(/[:.]/g, "-");
          const qid = currentQuestion?.id || "manual";
          const filename = `answer_${qid}_${ts}.webm`;
          const file = new File([blob], filename, { type: "video/webm" });

          try {
            setStatus("Uploading...");
            const fd = new FormData();
            fd.append("candidate_id", candidateId);
            fd.append("question_id", qid);
            fd.append("file", file);

            const res = await fetch(uploadUrl, { method: "POST", body: fd });
            const data = await res.json().catch(() => null);

            if (!res.ok) {
              console.error("Upload failed", data || res.statusText);
              setStatus("Upload failed");
            } else {
              setStatus("Uploaded");
              setHistory((h) => [
                { question: currentQuestion, filename, response: data },
                ...h,
              ]);
            }
          } catch (err) {
            console.error("Upload error", err);
            setStatus("Upload error");
          } finally {
            if (currentQuestion && autoRecordOnQuestion)
              setCurrentQuestion(null);
          }
        };
      } catch (err) {
        console.error("Camera access error", err);
        alert(
          "Could not access camera/microphone. Please allow permissions and reload."
        );
      }
    }

    initCamera();

    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [candidateId, uploadUrl, currentQuestion, autoRecordOnQuestion]);

  // ✅ WebSocket connection (for recruiter)
  useEffect(() => {
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      console.error("WebSocket constructor failed", err);
      return;
    }

    ws.onopen = () => {
      console.log("WS connected");
      setConnected(true);
      setStatus("Connected to recruiter");
    };

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === "question") onIncomingQuestion(data);
        else if (data.type === "next") stopRecording();
        else if (data.type === "end") setStatus("Interview ended");
      } catch {
        console.warn("WS message parse failed", msg.data);
      }
    };

    ws.onclose = () => {
      console.log("WS closed");
      setConnected(false);
      setStatus("Disconnected");
    };

    ws.onerror = (e) => {
      console.error("WS error", e);
      setStatus("WS error");
    };

    wsRef.current = ws;

    return () => {
      if (ws) ws.close();
    };
  }, [wsUrl, onIncomingQuestion]);

  // ✅ Question handler
  const onIncomingQuestion = useCallback((q) => {
    console.log("Incoming question", q);
    setCurrentQuestion(q);
    setStatus("Question received");
    speakText(q.text);
    if (autoRecordOnQuestion) {
      setTimeout(() => startRecording(), 300);
    }
  }, [autoRecordOnQuestion]);

  // ✅ Text-to-speech
  const speakText = (text) => {
    if (!window.speechSynthesis) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  };

  // ✅ Start recording
  const startRecording = () => {
    if (!mediaRecorderRef.current || !streamRef.current) return;
    if (mediaRecorderRef.current.state === "recording") return;

    chunksRef.current = [];
    try {
      mediaRecorderRef.current.start(1000);
      setIsRecording(true);
      setStatus("Recording");
    } catch (err) {
      console.error("Start recording error", err);
    }
  };

  // ✅ Stop recording
  const stopRecording = () => {
    if (!mediaRecorderRef.current) return;
    if (mediaRecorderRef.current.state !== "recording") return;

    try {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setStatus("Stopped - processing upload");
    } catch (err) {
      console.error("Stop recording error", err);
    }
  };

  const stopAll = () => {
    try {
      stopRecording(); // stop mediaRecorder if active
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setStatus("Webcam disconnected");
    } catch (err) {
      console.error("Stop all error", err);
    }
  };

  // ✅ Manual re-record
  const reRecordLast = () => {
    const last = history[0]?.question || null;
    if (!last) return alert("No previous question to re-record");
    setCurrentQuestion(last);
  };

  // ✅ Expose functions to parent (GiveTest)
  useImperativeHandle(ref, () => ({
    startRecording,
    stopRecording,
    stopAll,
  }));

  return (
    <div
      className="p-4"
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        maxWidth: 980,
        margin: "0 auto",
      }}
    >
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>Dynamic Recruiter Interview</h1>

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: "100%",
              borderRadius: 8,
              background: "#000",
            }}
          />

          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button onClick={() => (isRecording ? stopRecording() : startRecording())}>
              {isRecording ? "Stop Recording" : "Start Recording"}
            </button>
            <button onClick={() => setAutoRecordOnQuestion((s) => !s)}>
              {autoRecordOnQuestion ? "Disable auto-record" : "Enable auto-record"}
            </button>
          </div>

          <div style={{ marginTop: 8 }}>
            <small>
              Status: {status} | WS: {connected ? "connected" : "disconnected"}
            </small>
          </div>
        </div>

        <div style={{ width: 380 }}>
          <div
            style={{
              marginBottom: 12,
              padding: 12,
              borderRadius: 8,
              border: "1px solid #eee",
            }}
          >
            <strong>Current Question</strong>
            <div style={{ minHeight: 56, marginTop: 8 }}>
              {currentQuestion ? (
                <>
                  <div style={{ fontWeight: 600 }}>{currentQuestion.text}</div>
                  <div style={{ marginTop: 6, fontSize: 12, color: "#555" }}>
                    Question ID: {currentQuestion.id}
                  </div>
                </>
              ) : (
                <div style={{ color: "#777" }}>Waiting for recruiter question...</div>
              )}
            </div>
          </div>

          <div
            style={{
              padding: 12,
              borderRadius: 8,
              border: "1px solid #eee",
              maxHeight: 420,
              overflow: "auto",
            }}
          >
            <strong>Answer History</strong>
            <div style={{ marginTop: 8 }}>
              {history.length === 0 && (
                <div style={{ color: "#777" }}>No answers recorded yet</div>
              )}
              {history.map((h, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: 8,
                    borderBottom: "1px solid #f0f0f0",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {h.question?.text || "Manual"}
                  </div>
                  <div style={{ fontSize: 12, color: "#666" }}>
                    File: {h.filename}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button onClick={reRecordLast}>Re-record Last</button>
            <button onClick={() => setHistory([])}>Clear History</button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default WebCamRecorder;
