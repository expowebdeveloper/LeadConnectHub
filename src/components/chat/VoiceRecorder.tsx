import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Trash2, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Recorded = { blob: Blob; durationMs: number; mime: string };

/**
 * Click mic → start recording. Click stop → preview + send.
 * onSend receives the audio as a File ready for the existing upload pipeline.
 */
export function VoiceRecorder({
  onSend,
  sending,
}: {
  onSend: (file: File, durationMs: number) => Promise<void>;
  sending?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop();
    mediaRef.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const mr = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        const durationMs = Date.now() - startRef.current;
        setRecorded({ blob, durationMs, mime });
        stream.getTracks().forEach((t) => t.stop());
      };
      mr.start();
      mediaRef.current = mr;
      startRef.current = Date.now();
      setRecording(true);
      setElapsed(0);
      tickRef.current = setInterval(() => setElapsed(Date.now() - startRef.current), 200);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Microphone permission denied");
    }
  };

  const stop = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop();
    setRecording(false);
  };

  const discard = () => {
    setRecorded(null);
    setElapsed(0);
  };

  const send = async () => {
    if (!recorded) return;
    const ext = recorded.mime.includes("mp4") ? "m4a" : "webm";
    const file = new File([recorded.blob], `voice-${Date.now()}.${ext}`, { type: recorded.mime });
    try {
      await onSend(file, recorded.durationMs);
      setRecorded(null);
      setElapsed(0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send voice note");
    }
  };

  if (recorded) {
    const url = URL.createObjectURL(recorded.blob);
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1">
        <audio src={url} controls className="h-7 max-w-[160px]" />
        <span className="text-[10px] tabular-nums text-muted-foreground">{formatMs(recorded.durationMs)}</span>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={discard} disabled={sending}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" className="h-7 w-7" onClick={send} disabled={sending}>
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </Button>
      </div>
    );
  }

  if (recording) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1">
        <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
        <span className="text-[11px] font-mono tabular-nums text-destructive">{formatMs(elapsed)}</span>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={stop} title="Stop">
          <Square className="h-3.5 w-3.5 fill-current" />
        </Button>
      </div>
    );
  }

  return (
    <Button variant="ghost" size="icon" className="h-9 w-9" title="Record voice note" onClick={start}>
      <Mic className="h-4 w-4" />
    </Button>
  );
}

function formatMs(ms: number) {
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}