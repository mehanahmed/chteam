import { AudioWave, useMediaAudio } from "@audiowave/react";
import { Loader2 } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface AudioMessagePlayerProps {
  src: string;
  duration?: number;
  isOwn?: boolean;
  avatarUrl?: string | null;
  senderName?: string;
  timestamp?: string;
  meta?: React.ReactNode;
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
const BARS_COUNT = 30;

// Natural speech amplitude contour matching the exact reference image
const DEFAULT_WAVEFORM_BARS: number[] = [
  28, 45, 68, 85, 96, 100, 94, 88, 92, 96,
  88, 80, 84, 70, 56, 44, 32, 24, 18, 18,
  18, 18, 18, 18, 18, 18, 18, 18, 18, 18,
];

export function AudioMessagePlayer({
  src,
  duration: propDuration,
  isOwn = false,
  avatarUrl,
  senderName,
  timestamp,
  meta,
  ariaLabel = "Voice message",
  className = "",
}: AudioMessagePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(propDuration || 0);
  const [isLoading, setIsLoading] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [waveformData, setWaveformData] = useState<number[]>(DEFAULT_WAVEFORM_BARS);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [isAvatarHovered, setIsAvatarHovered] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);

  // Set audio element ref safely for useMediaAudio
  const setRef = useCallback((node: HTMLAudioElement | null) => {
    audioRef.current = node;
    setAudioElement(node);
  }, []);

  // Memoize audioOptions so useMediaAudio does not re-instantiate on every render
  const audioOptions = useMemo(
    () => ({
      source: audioElement,
      onError: () => {},
    }),
    [audioElement],
  );

  const { source } = useMediaAudio(audioOptions);

  // Extract waveform peaks from audio data if accessible, fallback to natural contour
  useEffect(() => {
    if (!src) return;
    let isCancelled = false;

    async function extractWaveform() {
      try {
        const response = await fetch(src, { mode: "cors" });
        if (!response.ok) return;
        const arrayBuffer = await response.arrayBuffer();

        const OfflineAudioContextClass =
          window.OfflineAudioContext ||
          (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

        let audioBuffer: AudioBuffer;
        if (OfflineAudioContextClass) {
          const offlineCtx = new OfflineAudioContextClass(1, 2, 44100);
          audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);
        } else if (AudioContextClass) {
          const audioCtx = new AudioContextClass();
          audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          audioCtx.close().catch(() => {});
        } else {
          return;
        }

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
          Math.max(18, Math.min(100, Math.round((val / maxPeak) * 100))),
        );

        if (!isCancelled && normalized.length === BARS_COUNT) {
          setWaveformData(normalized);
        }
      } catch {
        // Safe fallback without error
      }
    }

    void extractWaveform();
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

  // Seek/Scrub along the waveform
  const applySeekFromEvent = useCallback(
    (clientX: number) => {
      const audio = audioRef.current;
      const track = trackRef.current;
      if (!audio || !track || !duration) return;

      const rect = track.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const percentage = clickX / rect.width;
      const newTime = percentage * duration;

      audio.currentTime = newTime;
      setCurrentTime(newTime);
    },
    [duration],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      isDraggingRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      applySeekFromEvent(e.clientX);
    },
    [applySeekFromEvent],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      e.stopPropagation();
      applySeekFromEvent(e.clientX);
    },
    [applySeekFromEvent],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      e.stopPropagation();
      isDraggingRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Safe pointer release
      }
    },
    [],
  );

  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const currentSpeed = SPEED_OPTIONS[speedIndex];

  return (
    <div
      className={`relative flex items-center justify-between w-full min-w-[290px] max-w-[340px] select-none ${className}`}
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
          if (audioRef.current && !isDraggingRef.current) {
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

      {/* LEFT SECTION: Play button + Waveform + Duration & Timestamp */}
      <div className="flex-1 min-w-0 flex flex-col justify-center pr-3">
        {/* Top relative row with context menu chevron and waveform */}
        <div className="relative flex items-center gap-2.5">
          {/* WhatsApp-style minimal solid black Play / Pause button */}
          <button
            type="button"
            onClick={togglePlay}
            className="flex size-7 shrink-0 items-center justify-center text-black dark:text-[#e9edef] transition-transform active:scale-95"
            aria-label={isPlaying ? "Pause voice message" : "Play voice message"}
          >
            {isLoading ? (
              <Loader2 className="size-4.5 animate-spin text-black dark:text-[#e9edef]" />
            ) : isPlaying ? (
              /* WhatsApp Pause SVG */
              <svg viewBox="0 0 24 24" height="20" width="20" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              /* WhatsApp Play Triangle SVG */
              <svg viewBox="0 0 24 24" height="20" width="20" fill="currentColor">
                <path d="M9.53 18.02a.91.91 0 0 1-1.02.04.95.95 0 0 1-.51-.88V6.82c0-.4.17-.7.51-.88a.91.91 0 0 1 1.02.03l8.15 5.18c.3.2.45.48.45.85s-.15.65-.45.85l-8.15 5.17Z" />
              </svg>
            )}
          </button>

          {/* Waveform track with Cyan Scrubber Thumb */}
          <div
            ref={trackRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="relative flex-1 h-6 flex items-center cursor-pointer select-none group touch-none"
            role="slider"
            aria-valuenow={currentTime}
            aria-valuemin={0}
            aria-valuemax={duration}
            tabIndex={0}
          >
            {/* Waveform bars container (matching WhatsApp Web pixel-by-pixel) */}
            <div className="relative h-6 w-full flex items-center justify-between gap-[2px]">
              {waveformData.map((heightPct, idx) => {
                const barPercent = (idx / BARS_COUNT) * 100;
                const isFilled = barPercent <= progressPercent;

                return (
                  <span
                    key={idx}
                    className={`w-[2px] rounded-full transition-colors duration-100 ${
                      isFilled
                        ? "bg-[#34B7F1]"
                        : isOwn
                          ? "bg-[#8696a0]/50 dark:bg-white/35"
                          : "bg-[#c5cacd] dark:bg-white/35"
                    }`}
                    style={{ height: `${heightPct}%` }}
                  />
                );
              })}

              {/* Cyan Playhead Scrubber Knob Dot */}
              <div
                className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-transform group-hover:scale-115"
                style={{ left: `${progressPercent}%` }}
              >
                <div className="size-3.5 rounded-full bg-[#34B7F1] shadow-[0_1px_3px_rgba(52,183,241,0.5)] ring-1 ring-white/60 dark:ring-black/20" />
              </div>
            </div>

            {/* Live canvas visualizer from @audiowave/react when playing */}
            {source && isPlaying && (
              <div className="absolute inset-0 pointer-events-none opacity-30 overflow-hidden">
                <AudioWave
                  source={source}
                  width="100%"
                  height={24}
                  barColor="#34B7F1"
                  secondaryBarColor="transparent"
                  barWidth={2}
                  gap={2}
                  rounded={1}
                  amplitudeMode="peak"
                  animateCurrentPick={true}
                  isPaused={!isPlaying}
                  onError={() => {}}
                />
              </div>
            )}
          </div>

          {/* Context menu chevron icon at top right */}
          <div className="absolute right-0 -top-2 opacity-60 hover:opacity-100 transition-opacity text-[#8696a0] pointer-events-none">
            <svg viewBox="0 0 18 18" height="15" width="15" fill="currentColor">
              <path d="M3.3 5.7L9 11.4l5.7-5.7.8.8-6.5 6.5L2.5 6.5l.8-.8z" />
            </svg>
          </div>
        </div>

        {/* Lower Row: Duration on Left (0:03), Timestamp / Status on Right (3:39 PM) */}
        <div className="flex items-center justify-between text-[11px] leading-3 text-[#667781] dark:text-[#8696a0] mt-1.5 pl-[38px] select-none tabular-nums">
          <span>{isPlaying ? formatDuration(currentTime) : formatDuration(duration)}</span>
          {meta ? (
            <div className="flex items-center">{meta}</div>
          ) : timestamp ? (
            <span>{timestamp}</span>
          ) : null}
        </div>
      </div>

      {/* RIGHT SECTION: 55px Circular Avatar with Cyan Mic Badge & Speed Toggle */}
      <div
        className="relative shrink-0 size-[55px] select-none group/avatar"
        onMouseEnter={() => setIsAvatarHovered(true)}
        onMouseLeave={() => setIsAvatarHovered(false)}
      >
        {/* 55px Avatar circle */}
        <div className="size-[55px] rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 shadow-xs border border-black/5 dark:border-white/10">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={senderName || "Sender"}
              className="size-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLElement).style.display = "none";
              }}
            />
          ) : (
            <div className="size-full flex items-center justify-center bg-[#00a884] text-white font-semibold text-xl">
              {(senderName || "U").charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Cyan Mic badge at bottom-left corner of avatar */}
        <div
          className="absolute -bottom-0.5 -left-1.5 size-5 rounded-full bg-white dark:bg-[#202c33] shadow-[0_1px_2px_rgba(0,0,0,0.18)] flex items-center justify-center z-10 pointer-events-none"
          title="Voice message"
        >
          <svg viewBox="0 0 24 24" height="13" width="13" fill="#34B7F1">
            <path d="M12 14a2.9 2.9 0 0 1-2.13-.88A2.9 2.9 0 0 1 9 11V5c0-.83.3-1.54.88-2.13A2.9 2.9 0 0 1 12 2c.83 0 1.54.3 2.13.88.58.58.87 1.29.87 2.12v6c0 .83-.3 1.54-.88 2.13A2.9 2.9 0 0 1 12 14Zm0 7a.97.97 0 0 1-.71-.29A.97.97 0 0 1 11 20v-2.1a6.86 6.86 0 0 1-5.92-5.82.84.84 0 0 1 .22-.76c.2-.21.47-.32.8-.32.23 0 .44.09.63.26.18.18.3.39.34.64a4.93 4.93 0 0 0 1.7 2.92c.92.79 2 1.18 3.23 1.18s2.3-.4 3.22-1.18a4.93 4.93 0 0 0 1.7-2.92c.05-.25.18-.46.37-.64a1 1 0 0 1 1.41.06c.2.22.28.47.23.75A6.86 6.86 0 0 1 13 17.9V20c0 .28-.1.52-.29.71A.94.94 0 0 1 12 21Z" />
          </svg>
        </div>

        {/* Playback Speed Pill Button Overlay (displays when playing, hovered, or changed speed) */}
        <button
          type="button"
          onClick={cycleSpeed}
          className={`absolute inset-0 flex items-center justify-center rounded-full bg-black/45 backdrop-blur-[1px] transition-opacity cursor-pointer z-20 ${
            isPlaying || isAvatarHovered || speedIndex > 0
              ? "opacity-100"
              : "opacity-0 group-hover/avatar:opacity-100"
          }`}
          title={`Playback speed: ${currentSpeed}× (click to change)`}
          aria-label={`Change playback speed, currently ${currentSpeed}×`}
        >
          <div className="rounded-full bg-black/75 px-2 py-0.5 text-[12px] font-semibold text-white shadow-xs">
            {currentSpeed}×
          </div>
        </button>
      </div>
    </div>
  );
}
