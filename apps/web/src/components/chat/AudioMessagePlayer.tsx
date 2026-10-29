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
        await audio.play();
      } catch {
        // Play interrupted or permission denied
      } finally {
        setIsLoading(false);
      }
    }
  }, [isPlaying]);

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

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Visualizer bar colors matching WhatsApp Web
  const barColor = isOwn ? "#00a884" : "#00a884";
  const secondaryBarColor = isOwn ? "#8696a0" : "#d1d7db";

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

      <div className="flex items-center gap-3">
        {/* WhatsApp-style Play / Pause circular button */}
        <button
          type="button"
          onClick={togglePlay}
          className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all active:scale-95 ${
            isOwn
              ? "bg-[#00a884] text-white hover:bg-[#008f72] dark:bg-[#00a884]"
              : "bg-[#00a884] text-white hover:bg-[#008f72] dark:bg-[#00a884]"
          } shadow-sm`}
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

        {/* Waveform & Scrubber container */}
        <div
          ref={trackRef}
          onClick={handleSeek}
          className="relative flex-1 cursor-pointer py-1 group"
          role="slider"
          aria-valuenow={currentTime}
          aria-valuemin={0}
          aria-valuemax={duration}
          tabIndex={0}
        >
          <div className="relative h-8 w-full flex items-center overflow-hidden rounded">
            {source ? (
              <AudioWave
                source={source}
                width="100%"
                height={32}
                barColor={barColor}
                secondaryBarColor={secondaryBarColor}
                barWidth={2}
                gap={2}
                rounded={1}
                amplitudeMode="peak"
                animateCurrentPick={true}
                isPaused={!isPlaying}
                onError={() => {
                  // Silent fallback
                }}
              />
            ) : (
              /* Fallback static waveform bars when audio is paused or source preparing */
              <div className="flex items-center w-full justify-between gap-[2px] h-6 px-0.5">
                {STATIC_WAVEFORM_HEIGHTS.map((heightPct, idx) => {
                  const barProgress = (idx / STATIC_WAVEFORM_HEIGHTS.length) * 100;
                  const isFilled = barProgress <= progressPercent;
                  return (
                    <span
                      key={idx}
                      className={`w-[2px] rounded-full transition-colors duration-150 ${
                        isFilled
                          ? "bg-[#00a884]"
                          : isOwn
                            ? "bg-[#8696a0]/60 dark:bg-white/30"
                            : "bg-[#8696a0]/50 dark:bg-white/30"
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Scrubber progress track overlay */}
          <div className="relative mt-1 h-1 w-full rounded-full bg-black/10 dark:bg-white/15 overflow-hidden">
            <div
              className="h-full bg-[#00a884] transition-all duration-100 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Speed toggle chip (1x, 1.5x, 2x like WhatsApp) */}
        <button
          type="button"
          onClick={cycleSpeed}
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ${
            isOwn
              ? "bg-black/5 hover:bg-black/10 text-gray-700 dark:bg-white/10 dark:text-gray-200"
              : "bg-black/5 hover:bg-black/10 text-gray-700 dark:bg-white/10 dark:text-gray-200"
          }`}
          title="Playback speed"
        >
          {SPEED_OPTIONS[speedIndex]}x
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

// Pseudo-random normalized waveform pattern for natural WhatsApp voice note appearance
const STATIC_WAVEFORM_HEIGHTS = [
  30, 45, 60, 35, 75, 90, 40, 65, 80, 50, 95, 70, 40, 85, 60, 45, 90, 55, 70,
  35, 80, 65, 50, 85, 40, 60, 75, 45, 90, 70, 35, 65, 80, 55, 40, 75, 60, 35,
];
