/**
 * VoiceDictationButton — browser-native speech-to-text, zero backend.
 *
 * Uses the Web Speech API (window.SpeechRecognition / webkitSpeechRecognition)
 * which is built into Chromium-based browsers (Chrome, Edge, Brave). No audio
 * is sent to any server — recognition happens in the browser.
 *
 * When active, dictated text is appended to the target field at the cursor
 * position. Click again to stop.
 *
 * Fallback: if the browser doesn't support speech recognition (e.g. Firefox),
 * the button is disabled with a tooltip.
 */
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";

// Minimal type for the Web Speech API (not in standard TS lib)
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function getRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export default function VoiceDictationButton({
  onText,
  disabled,
}: {
  /** Called with each finalized transcript chunk. */
  onText: (text: string) => void;
  disabled?: boolean;
}) {
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    const rec = getRecognition();
    if (!rec) {
      setSupported(false);
      return;
    }
    rec.lang = "en-IN";
    rec.continuous = true;
    rec.interimResults = false;

    rec.onresult = (e) => {
      for (let i = 0; i < e.results.length; i++) {
        const transcript = e.results[i][0]?.transcript ?? "";
        if (transcript.trim()) {
          onText(transcript.trim() + " ");
        }
      }
    };
    rec.onerror = (e) => {
      console.warn("[voice] error:", e.error);
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
    };
    recRef.current = rec;

    return () => {
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    };
  }, [onText]);

  function toggle() {
    if (!recRef.current) return;
    if (listening) {
      recRef.current.stop();
      setListening(false);
    } else {
      try {
        recRef.current.start();
        setListening(true);
      } catch {
        /* already started */
      }
    }
  }

  if (!supported) {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled
        title="Voice dictation requires Chrome, Edge, or Brave (Web Speech API not available in this browser)"
        className="text-muted-foreground"
      >
        <MicOff className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <Button
      variant={listening ? "default" : "ghost"}
      size="sm"
      onClick={toggle}
      disabled={disabled}
      title={listening ? "Stop dictation" : "Start voice dictation"}
      className={listening ? "bg-red-500 hover:bg-red-600 text-white animate-pulse" : "text-muted-foreground"}
    >
      <Mic className="h-4 w-4" />
      {listening && <span className="text-xs ml-1">Listening…</span>}
    </Button>
  );
}
