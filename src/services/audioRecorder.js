import { CapacitorAudioRecorder } from "@capgo/capacitor-audio-recorder";

export const IS_ANDROID = typeof window !== "undefined" &&
  typeof window.Capacitor !== "undefined" && /Android/i.test(navigator.userAgent);

export function createAudioRecorder() {
  if (IS_ANDROID) {
    let started = false;
    return {
      async start() {
        const permission = await CapacitorAudioRecorder.requestPermission().catch(() => null);
        if (permission?.granted === false) {
          throw new Error("Permission microphone refusée");
        }
        await CapacitorAudioRecorder.startRecording();
        started = true;
      },
      async stop() {
        if (!started) return null;
        started = false;
        const result = await CapacitorAudioRecorder.stopRecording();
        if (result?.uri) {
          return window.Capacitor?.convertFileSrc(result.uri) ?? result.uri;
        }
        const raw = result?.value ?? result?.recordDataBase64 ?? result?.blob ?? null;
        return raw ? URL.createObjectURL(raw) : null;
      },
      release() {
        if (started) {
          CapacitorAudioRecorder.stopRecording().catch(() => {});
          started = false;
        }
      },
    };
  }

  let stream = null;
  let mediaRecorder = null;
  let chunks = [];
  let mime = "";
  let audioContext = null;

  return {
    async start(gainValue = 4.0) {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      let recordStream = stream;
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(stream);
        const gain = audioContext.createGain();
        gain.gain.value = gainValue;
        const destination = audioContext.createMediaStreamDestination();
        source.connect(gain);
        gain.connect(destination);
        recordStream = destination.stream;
      } catch (error) {
        console.warn("[Recorder] GainNode unavailable, recording raw:", error);
      }

      mime = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ].find((type) => {
        try {
          return MediaRecorder.isTypeSupported(type);
        } catch {
          return false;
        }
      }) || "";

      mediaRecorder = new MediaRecorder(
        recordStream,
        mime ? { mimeType: mime } : undefined,
      );
      chunks = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data?.size > 0) chunks.push(event.data);
      };
      mediaRecorder.start(200);
    },

    stop() {
      return new Promise((resolve) => {
        if (!mediaRecorder || mediaRecorder.state === "inactive") {
          resolve(null);
          return;
        }
        mediaRecorder.onstop = () => {
          stream?.getTracks().forEach((track) => track.stop());
          try {
            audioContext?.close();
          } catch {}
          audioContext = null;
          resolve(
            chunks.length
              ? URL.createObjectURL(new Blob(chunks, { type: mime || "audio/webm" }))
              : null,
          );
        };
        mediaRecorder.stop();
      });
    },

    release() {
      try {
        if (mediaRecorder?.state !== "inactive") mediaRecorder?.stop();
      } catch {}
      stream?.getTracks().forEach((track) => track.stop());
      try {
        audioContext?.close();
      } catch {}
      audioContext = null;
    },
  };
}
