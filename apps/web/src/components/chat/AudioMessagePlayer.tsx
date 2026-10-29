import { AudioWave, useMediaAudio } from "@audiowave/react";
import { Loader2, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface AudioMessagePlayerProps {
  src: string;
  duration?: number;
  isOwn?: boolean;
  ariaLabel?: string;
  className?: string;
}

function formatDuration(seconds: number): string {
  if (!seconds || Number.isNaN(seconds) || !Number.isFinite(seconds)) {
    return "0:00";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const SPEED_OPTIONS = [1, 1.5, 2] as const;
const BARS_COUNT = 64;

// Default natural speech amplitude contour (64 bars, percentage 15-100)
const DEFAULT_64_BARS: number[] = [
  20, 25, 32, 45, 60, 52, 40, 68, 85, 95, 82, 65, 55, 38, 28, 42,
  64, 78, 88, 74, 60, 48, 68, 84, 100, 92, 72, 56, 42, 34, 48, 62,
  74, 86, 94, 82, 62, 46, 36, 54, 68, 84, 76, 58, 48, 38, 58, 74,
  86, 96, 82, 66, 52, 38, 32, 44, 58, 68, 54, 42, 32, 26, 20, 16,
];

export function AudioMessagePlayer({
  src,
  duration: propDuration,
  isOwn = false,
  ariaLabel = "Audio message",
  className = "",
}: AudioMessagePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(propDuration || 0);
  const [isLoading, setIsLoading] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [waveformData, setWaveformData] = useState<number[]>(DEFAULT_64_BARS);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  // Set audio element ref safely for useMediaAudio
  const setRef = useCallback((node: HTMLAudioElement | null) => {
    audioRef.current = node;
    setAudioElement(node);
  }, []);

  // Memoize audioOptions so useMediaAudio does not re-instantiate on every render
  const audioOptions = useMemo(
    () => ({
      source: audioElement,
      onError: () => {
        // Graceful error suppression, ensures audio element continues working even if Web Audio fails
      },
    }),
    [audioElement],
  );

  const { source } = useMediaAudio(audioOptions);

  // Extract 64-bar waveform peaks from audio data if accessible, fallback to natural contour
  useEffect(() => {
    if (!src) return;
    let isCancelled = false;

    async function extract64BarWaveform() {
      try {
        const response = await fetch(src, { mode: "cors" });
        if (!response.ok) return;
        const arrayBuffer = await response.arrayBuffer();

        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) return;

        const audioCtx = new AudioContextClass();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        audioCtx.close().catch(() => {});

        const rawData = audioBuffer.getChannelData(0);
        const blockSize = Math.floor(rawData.length / BARS_COUNT);
        if (blockSize <= 0) return;

        const sampledBars: number[] = [];
        for (let i = 0; i < BARS_COUNT; i++) {
          const blockStart = blockSize * i;
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[blockStart + j] || 0);
          }
          sampledBars.push(sum / blockSize);
        }

        const maxPeak = Math.max(...sampledBars, 0.001);
        const normalized = sampledBars.map((val) =>
          Math.max(16, Math.min(100, Math.round((val / maxPeak) * 100))),
        );

        if (!isCancelled && normalized.length === BARS_COUNT) {
          setWaveformData(normalized);
        }
      } catch {
        // Safe fallback without any user-facing error
      }
    }

    void extract64BarWaveform();
    return () => {
      isCancelled = true;
    };
  }, [src]);

  // Sync initial duration
  useEffect(() => {
    if (propDuration && propDuration > 0 && !duration) {
      setDuration(propDuration);
    }
  }, [propDuration, duration]);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      try {
        setIsLoading(true);
        // Ensure playbackRate is preserved
        audio.playbackRate = SPEED_OPTIONS[speedIndex];
        await audio.play();
      } catch {
        // Play interrupted or permission denied
      } finally {
        setIsLoading(false);
      }
    }
  }, [isPlaying, speedIndex]);

  // Cycle playback speed: 1x -> 1.5x -> 2x -> 1x
  const cycleSpeed = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const nextIndex = (speedIndex + 1) % SPEED_OPTIONS.length;
      setSpeedIndex(nextIndex);
      const nextSpeed = SPEED_OPTIONS[nextIndex];
      if (audioRef.current) {
        audioRef.current.playbackRate = nextSpeed;
      }
    },
    [speedIndex],
  );

  // Seek/Scrub along the 64-bar waveform
  const handleSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      const track = trackRef.current;
      if (!audio || !track || !duration) return;

      const rect = track.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const percentage = clickX / rect.width;
      const newTime = percentage * duration;

      audio.currentTime = newTime;
      setCurrentTime(newTime);
    },
    [duration],
  );

  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const currentSpeed = SPEED_OPTIONS[speedIndex];

  return (
    <div
      className={`flex flex-col gap-1 min-w-[240px] max-w-[340px] select-none py-1 ${className}`}
      aria-label={ariaLabel}
    >
      {/* Hidden audio element that drives playback */}
      <audio
        ref={setRef}
        src={src}
        preload="metadata"
        crossOrigin="anonymous"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
        onTimeUpdate={() => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
          }
        }}
        onLoadedMetadata={() => {
          if (audioRef.current && Number.isFinite(audioRef.current.duration)) {
            setDuration(audioRef.current.duration);
          }
        }}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => setIsLoading(false)}
      />

      <div className="flex items-center gap-2.5">
        {/* WhatsApp-style Play / Pause circular button */}
        <button
          type="button"
          onClick={togglePlay}
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white transition-all active:scale-95 hover:bg-[#008f72] shadow-sm"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-5 w-5 fill-current" />
          ) : (
            <Play className="h-5 w-5 fill-current ml-0.5" />
          )}
        </button>

        {/* 64-Bar Amplitude Waveform Scrubber with Scrubber Knob */}
        <div
          ref={trackRef}
          onClick={handleSeek}
          className="relative flex-1 cursor-pointer py-1.5 group select-none"
          role="slider"
          aria-valuenow={currentTime}
          aria-valuemin={0}
          aria-valuemax={duration}
          tabIndex={0}
        >
          {/* Waveform bars container (64 bars) */}
          <div className="relative h-7 w-full flex items-center justify-between gap-[1.5px]">
            {waveformData.map((heightPct, idx) => {
              const barPercent = (idx / BARS_COUNT) * 100;
              const isFilled = barPercent <= progressPercent;

              return (
                <span
                  key={idx}
                  className={`w-[2px] rounded-full transition-colors duration-100 ${
                    isFilled
                      ? "bg-[#00a884]"
                      : isOwn
                        ? "bg-[#8696a0]/60 dark:bg-white/35"
                        : "bg-[#8696a0]/45 dark:bg-white/35"
                  }`}
                  style={{ height: `${heightPct}%` }}
                />
              );
            })}

            {/* Playhead circular scrubber thumb handle */}
            <div
              className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-transform group-hover:scale-125"
              style={{ left: `${progressPercent}%` }}
            >
              <div className="h-3 w-3 rounded-full bg-[#00a884] shadow ring-2 ring-white dark:ring-dark-secondary" />
            </div>
          </div>

          {/* Optional live canvas visualizer from @audiowave/react when playing */}
          {source && isPlaying && (
            <div className="absolute inset-0 opacity-20 pointer-events-none overflow-hidden">
              <AudioWave
                source={source}
                width="100%"
                height={28}
                barColor="#00a884"
                secondaryBarColor="transparent"
                barWidth={2}
                gap={1.5}
                rounded={1}
                amplitudeMode="peak"
                animateCurrentPick={true}
                isPaused={!isPlaying}
                onError={() => {}}
              />
            </div>
          )}
        </div>

        {/* Speed toggle chip (1x, 1.5x, 2x like WhatsApp) */}
        <button
          type="button"
          onClick={cycleSpeed}
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-all active:scale-95 ${
            currentSpeed === 2
              ? "bg-[#00a884] text-white shadow-xs"
              : currentSpeed === 1.5
                ? "bg-[#00a884]/20 text-[#00a884] font-bold"
                : isOwn
                  ? "bg-black/5 hover:bg-black/10 text-gray-700 dark:bg-white/10 dark:text-gray-200"
                  : "bg-black/5 hover:bg-black/10 text-gray-700 dark:bg-white/10 dark:text-gray-200"
          }`}
          title="Change playback speed"
          aria-label={`Playback speed: ${currentSpeed}x`}
        >
          {currentSpeed}x
        </button>
      </div>

      {/* Duration and current time display */}
      <div className="flex items-center justify-between px-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 tabular-nums">
        <span>{isPlaying ? formatDuration(currentTime) : formatDuration(duration)}</span>
        {duration > 0 && isPlaying && (
          <span className="opacity-75">{formatDuration(duration)}</span>
        )}
      </div>
    </div>
  );
}
