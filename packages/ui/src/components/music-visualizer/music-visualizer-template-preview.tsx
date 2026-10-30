import React from "react";
import { cn } from "@/lib/utils";
import type { MusicVisualizerLayerTemplate } from "@/types/music-visualizer";
import "./music-visualizer-template-preview.css";

/** Shared style illustrations for the visualizer creator and native editor. */
export function VisualizerTemplatePreview(props: {
  template: MusicVisualizerLayerTemplate;
  borderless?: boolean;
}) {
  return (
    <span className="music-visualizer-template-preview">
      <VisualizerTemplateArtwork {...props} />
    </span>
  );
}

function VisualizerTemplateArtwork({
  template,
  borderless,
}: {
  template: MusicVisualizerLayerTemplate;
  borderless?: boolean;
}) {
  const gradientId = React.useId();
  if (template.key === "cassette-vu-meter") {
    return (
      <span
        aria-hidden="true"
        className="relative block h-24 overflow-hidden rounded-md bg-gray-950 p-3"
        style={{
          background: `linear-gradient(145deg, ${template.background}, #020617), radial-gradient(circle at 70% 20%, ${template.accent}55, transparent 34%)`,
        }}
      >
        <span className="absolute inset-2 rounded-md bg-white/5" />
        <span
          className={cn(
            "absolute left-[18%] top-[25%] h-8 w-8 rounded-full shadow-inner",
            borderless
              ? "bg-white/10"
              : "border-[6px] border-white/20 bg-gray-950",
          )}
        />
        <span
          className={cn(
            "absolute right-[18%] top-[25%] h-8 w-8 rounded-full shadow-inner",
            borderless
              ? "bg-white/10"
              : "border-[6px] border-white/20 bg-gray-950",
          )}
        />
        <span
          className={cn(
            "absolute bottom-4 left-1/2 h-7 w-2/3 -translate-x-1/2 rounded-md bg-black/35",
            !borderless && "ring-1 ring-white/10",
          )}
        >
          <span
            className="absolute bottom-2 left-4 h-1 w-10 rounded-full"
            style={{ background: template.accent }}
          />
          <span
            className="absolute bottom-2 right-4 h-1 w-10 rounded-full"
            style={{ background: template.secondary }}
          />
        </span>
      </span>
    );
  }

  if (template.key === "waveform-line") {
    return (
      <span
        aria-hidden="true"
        className="relative block h-24 overflow-hidden rounded-md bg-gray-950 p-3"
        style={{
          background: `radial-gradient(circle at 50% 50%, ${template.accent}33, transparent 55%), #030712`,
        }}
      >
        <span
          className="absolute inset-x-4 top-1/2 h-10 -translate-y-1/2 rounded-full blur-lg"
          style={{ background: template.glow }}
        />
        <svg
          viewBox="0 0 100 40"
          preserveAspectRatio="none"
          className="absolute inset-x-4 top-1/2 h-10 w-[calc(100%-2rem)] -translate-y-1/2"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={template.accent} />
              <stop offset="100%" stopColor={template.secondary} />
            </linearGradient>
          </defs>
          <path
            d="M0,20 L8,12 L16,24 L24,8 L32,26 L40,14 L48,22 L56,10 L64,25 L72,15 L80,23 L88,13 L100,20 L100,20 L88,27 L80,17 L72,25 L64,15 L56,30 L48,18 L40,26 L32,14 L24,32 L16,16 L8,28 L0,20 Z"
            fill={`url(#${gradientId})`}
            opacity="0.55"
          />
          <path
            d="M0,20 L8,12 L16,24 L24,8 L32,26 L40,14 L48,22 L56,10 L64,25 L72,15 L80,23 L88,13 L100,20"
            fill="none"
            stroke={template.foreground}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }

  if (template.key === "mirror-bars") {
    return (
      <span
        aria-hidden="true"
        className="relative block h-24 overflow-hidden rounded-md bg-gray-950 p-3"
        style={{
          background: `radial-gradient(circle at 50% 50%, ${template.accent}33, transparent 55%), #030712`,
        }}
      >
        <span
          className="absolute inset-x-5 top-1/2 h-6 -translate-y-1/2 rounded-full blur-xl"
          style={{ background: template.glow }}
        />
        <span className="absolute inset-x-4 top-1/2 flex h-16 -translate-y-1/2 items-center gap-1">
          {[26, 46, 34, 58, 40, 62, 44, 52, 30, 48, 36, 24].map(
            (height, index) => (
              <span
                key={`${height}-${index}`}
                className="flex flex-1 flex-col items-center gap-[3px]"
              >
                <span
                  className="w-full rounded-full"
                  style={{
                    height: height / 2,
                    background:
                      index % 3 === 0 ? template.secondary : template.accent,
                    boxShadow: `0 0 10px ${template.glow}`,
                  }}
                />
                <span
                  className="w-full rounded-full opacity-70"
                  style={{
                    height: height / 2,
                    background:
                      index % 3 === 0 ? template.secondary : template.accent,
                  }}
                />
              </span>
            ),
          )}
        </span>
      </span>
    );
  }

  if (template.key === "circular-spectrum") {
    return (
      <span
        aria-hidden="true"
        className="relative block h-24 overflow-hidden rounded-md bg-gray-950"
        style={{
          background: `radial-gradient(circle, ${template.accent}2e, transparent 58%), #030712`,
        }}
      >
        <span
          className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background: `radial-gradient(circle at 35% 30%, ${template.foreground}, ${template.accent} 32%, ${template.secondary}55 70%)`,
            boxShadow: `0 0 24px ${template.glow}`,
          }}
        />
        {Array.from({ length: 24 }).map((_, index) => (
          <span
            key={index}
            className="absolute left-1/2 top-1/2 h-[2px] origin-left rounded-full"
            style={{
              width: `${24 + (index % 5) * 3}px`,
              background:
                index % 4 === 0 ? template.secondary : template.accent,
              transform: `rotate(${index * 15}deg) translateX(31px)`,
              boxShadow: `0 0 7px ${template.glow}`,
            }}
          />
        ))}
      </span>
    );
  }

  if (template.key === "neon-waveform") {
    return (
      <span
        aria-hidden="true"
        className="relative block h-24 overflow-hidden rounded-md bg-gray-950"
        style={{
          background: `radial-gradient(ellipse, ${template.accent}24, transparent 62%), #030712`,
        }}
      >
        {[0, 1, 2].map((line) => (
          <span
            key={line}
            className="absolute left-[8%] right-[8%] top-1/2 h-[3px] rounded-full"
            style={{
              background: `linear-gradient(90deg, ${template.secondary}, ${template.foreground}, ${template.accent})`,
              boxShadow: `0 0 ${10 - line * 2}px ${template.glow}`,
              opacity: line === 0 ? 1 : 0.45,
              transform: `translateY(${(line - 1) * 12}px) skewY(${line === 1 ? -9 : line === 2 ? 7 : 11}deg)`,
            }}
          />
        ))}
        {[18, 34, 22, 44, 28, 38, 16, 32].map((height, index) => (
          <span
            key={`${height}-${index}`}
            className="absolute top-1/2 w-[2px] -translate-y-1/2 rounded-full"
            style={{
              left: `${13 + index * 10.5}%`,
              height,
              background: index % 2 ? template.accent : template.secondary,
              boxShadow: `0 0 7px ${template.glow}`,
            }}
          />
        ))}
      </span>
    );
  }

  if (template.key === "pulse-rings") {
    return (
      <span
        aria-hidden="true"
        className="relative block h-24 overflow-hidden rounded-md bg-gray-950"
        style={{
          background: `radial-gradient(circle, ${template.accent}35, transparent 60%), #030712`,
        }}
      >
        {[62, 46, 30].map((size, index) => (
          <span
            key={size}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
            style={{
              width: size,
              height: size,
              borderColor: index % 2 ? template.secondary : template.accent,
              opacity: 0.34 + index * 0.2,
              boxShadow: `0 0 12px ${template.glow}`,
            }}
          />
        ))}
        <span
          className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background: template.foreground,
            boxShadow: `0 0 18px ${template.glow}`,
          }}
        />
      </span>
    );
  }

  if (template.key === "particle-galaxy") {
    return (
      <span
        aria-hidden="true"
        className="relative block h-24 overflow-hidden rounded-md bg-gray-950"
        style={{
          background: `radial-gradient(ellipse, ${template.secondary}38, transparent 38%), #030712`,
        }}
      >
        {Array.from({ length: 38 }).map((_, index) => {
          const angle = index * 2.399;
          const radius = 8 + (index % 9) * 4.5;
          return (
            <span
              key={index}
              className="absolute rounded-full"
              style={{
                left: `${50 + Math.cos(angle) * radius}%`,
                top: `${50 + Math.sin(angle) * radius * 0.46}%`,
                width: 2 + (index % 3),
                height: 2 + (index % 3),
                background:
                  index % 4 === 0
                    ? template.foreground
                    : index % 2
                      ? template.accent
                      : template.secondary,
                boxShadow: `0 0 7px ${template.glow}`,
              }}
            />
          );
        })}
        <span
          className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background: `radial-gradient(circle, ${template.foreground}, ${template.accent}, transparent 72%)`,
          }}
        />
      </span>
    );
  }

  if (template.key === "album-cover-pulse") {
    return (
      <span
        aria-hidden="true"
        className="relative block h-24 overflow-hidden rounded-md bg-gray-950"
        style={{
          background: `radial-gradient(circle, ${template.accent}38, transparent 58%), #030712`,
        }}
      >
        {[66, 54].map((size, index) => (
          <span
            key={size}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border"
            style={{
              width: size,
              height: size,
              borderColor: index ? template.secondary : template.accent,
              opacity: 0.42,
            }}
          />
        ))}
        <span
          className="absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-md ring-1 ring-white/30"
          style={{
            background: `linear-gradient(135deg, ${template.secondary}, ${template.accent} 55%, #020617)`,
            boxShadow: `0 10px 24px rgba(0,0,0,.55), 0 0 18px ${template.glow}`,
          }}
        >
          <span className="absolute inset-[28%] rounded-full bg-gray-950 ring-2 ring-white/40" />
        </span>
      </span>
    );
  }

  if (
    [
      "audio-blob",
      "starfield-tunnel",
      "equalizer-grid",
      "liquid-gradient",
      "kaleidoscope",
      "vinyl-record",
      "audio-terrain",
      "lightning-arc",
      "minimal-line-art",
    ].includes(template.key)
  ) {
    return (
      <span
        aria-hidden="true"
        className="relative block h-24 overflow-hidden rounded-md bg-gray-950"
        style={{
          background:
            template.key === "liquid-gradient"
              ? `radial-gradient(circle at 25% 25%, ${template.accent}99, transparent 38%), radial-gradient(circle at 75% 65%, ${template.secondary}99, transparent 42%), #030712`
              : `radial-gradient(circle, ${template.accent}26, transparent 62%), #030712`,
        }}
      >
        {template.key === "audio-blob" ? (
          <>
            {[58, 46, 34].map((size, index) => (
              <span
                key={size}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{
                  width: size,
                  height: size - index * 3,
                  borderRadius: `${62 - index * 8}% ${38 + index * 8}% ${55 + index * 5}% ${45 - index * 5}%`,
                  background:
                    index === 2
                      ? `linear-gradient(135deg, ${template.foreground}, ${template.accent}, ${template.secondary})`
                      : "transparent",
                  border: `2px solid ${index % 2 ? template.secondary : template.accent}`,
                  opacity: 0.45 + index * 0.2,
                  boxShadow: `0 0 14px ${template.glow}`,
                  transform: `translate(-50%, -50%) rotate(${index * 28}deg)`,
                }}
              />
            ))}
          </>
        ) : null}

        {template.key === "starfield-tunnel" ? (
          <>
            {Array.from({ length: 34 }).map((_, index) => {
              const angle = index * 2.399;
              const radius = 4 + (index % 9) * 4.7;
              return (
                <span
                  key={index}
                  className="absolute h-[2px] origin-left rounded-full"
                  style={{
                    left: `${50 + Math.cos(angle) * radius}%`,
                    top: `${50 + Math.sin(angle) * radius * 0.58}%`,
                    width: 3 + (index % 5) * 2,
                    background:
                      index % 4 === 0
                        ? template.secondary
                        : template.foreground,
                    boxShadow: `0 0 6px ${template.glow}`,
                    transform: `rotate(${(angle * 180) / Math.PI}deg)`,
                  }}
                />
              );
            })}
          </>
        ) : null}

        {template.key === "equalizer-grid" ? (
          <span className="absolute inset-3 grid grid-cols-12 grid-rows-6 gap-1">
            {Array.from({ length: 72 }).map((_, index) => {
              const row = Math.floor(index / 12);
              const column = index % 12;
              const lit = 5 - row <= 1 + ((column * 7) % 6);
              return (
                <span
                  key={index}
                  className="rounded-[2px]"
                  style={{
                    background: lit
                      ? row < 2
                        ? template.secondary
                        : template.accent
                      : "rgba(255,255,255,.08)",
                    boxShadow: lit ? `0 0 6px ${template.glow}` : undefined,
                  }}
                />
              );
            })}
          </span>
        ) : null}

        {template.key === "liquid-gradient" ? (
          <>
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="absolute rounded-full blur-md"
                style={{
                  left: `${8 + index * 28}%`,
                  top: `${12 + (index % 2) * 35}%`,
                  width: `${42 - index * 4}%`,
                  aspectRatio: "1",
                  background: index % 2 ? template.secondary : template.accent,
                  opacity: 0.3,
                }}
              />
            ))}
            <span
              className="absolute left-[8%] right-[8%] top-1/2 h-1 -translate-y-1/2 -skew-y-6 rounded-full"
              style={{
                background: template.foreground,
                boxShadow: `0 0 12px ${template.glow}`,
              }}
            />
          </>
        ) : null}

        {template.key === "kaleidoscope" ? (
          <>
            {[68, 48, 28].map((size, index) => (
              <span
                key={size}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  width: size,
                  height: size,
                  background: `repeating-conic-gradient(from ${index * 18}deg, ${template.accent} 0 14deg, transparent 14deg 28deg, ${template.secondary} 28deg 40deg, transparent 40deg 60deg)`,
                  opacity: 0.62 - index * 0.08,
                  filter: `drop-shadow(0 0 5px ${template.glow})`,
                  transform: `translate(-50%, -50%) rotate(${index * 22}deg)`,
                }}
              />
            ))}
          </>
        ) : null}

        {template.key === "vinyl-record" ? (
          <>
            <span
              className="absolute left-[18%] top-1/2 h-16 w-16 -translate-y-1/2 rounded-full"
              style={{
                background: `repeating-radial-gradient(circle, #080808 0 3px, #202020 4px 5px), radial-gradient(circle, ${template.foreground} 0 5%, ${template.accent} 6% 16%, ${template.secondary} 17% 24%, #090909 25%)`,
                boxShadow: `0 0 16px ${template.glow}`,
              }}
            />
            <span
              className="absolute right-[17%] top-[22%] h-2 w-14 origin-right rotate-[32deg] rounded-full"
              style={{ background: template.foreground }}
            />
          </>
        ) : null}

        {template.key === "audio-terrain" ? (
          <span className="absolute inset-x-3 bottom-1 top-5 -skew-y-6 space-y-1">
            {Array.from({ length: 9 }).map((_, row) => (
              <span
                key={row}
                className="flex h-1.5 items-end gap-[2px]"
                style={{ opacity: 0.2 + row * 0.08 }}
              >
                {Array.from({ length: 18 }).map((__, column) => (
                  <span
                    key={column}
                    className="flex-1 rounded-full"
                    style={{
                      height: `${35 + ((column * 11 + row * 7) % 65)}%`,
                      background:
                        column % 5 ? template.accent : template.secondary,
                      boxShadow: `0 0 4px ${template.glow}`,
                    }}
                  />
                ))}
              </span>
            ))}
          </span>
        ) : null}

        {template.key === "lightning-arc" ? (
          <>
            {Array.from({ length: 14 }).map((_, index) => (
              <span
                key={index}
                className="absolute left-1/2 top-1/2 h-[2px] origin-left rounded-full"
                style={{
                  width: 18 + (index % 4) * 7,
                  background:
                    index % 3 === 0 ? template.secondary : template.foreground,
                  boxShadow: `0 0 8px ${template.glow}`,
                  transform: `rotate(${index * 51 + (index % 4) * 8}deg) translateX(${(index % 3) * 8}px)`,
                }}
              />
            ))}
          </>
        ) : null}

        {template.key === "minimal-line-art" ? (
          <>
            {Array.from({ length: 5 }).map((_, line) => (
              <span
                key={line}
                className="absolute left-[7%] right-[7%] h-px rounded-full"
                style={{
                  top: `${30 + line * 10}%`,
                  background:
                    line === 2 ? template.foreground : template.secondary,
                  opacity: line === 2 ? 0.9 : 0.35,
                  boxShadow:
                    line === 2 ? `0 0 8px ${template.glow}` : undefined,
                  transform: `skewY(${line % 2 ? 5 : -5}deg) translateY(${(line - 2) * 2}px)`,
                }}
              />
            ))}
          </>
        ) : null}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="relative block h-24 overflow-hidden rounded-md bg-gray-950 p-3"
      style={{
        background:
          `radial-gradient(circle at 25% 25%, ${template.secondary}55, transparent 35%), ` +
          `radial-gradient(circle at 78% 20%, ${template.accent}44, transparent 32%), #030712`,
      }}
    >
      <span
        className="absolute inset-x-5 top-5 h-8 rounded-full blur-xl"
        style={{ background: template.glow }}
      />
      <span className="absolute inset-x-4 bottom-4 flex items-end gap-1">
        {[18, 34, 26, 48, 62, 38, 76, 46, 64, 28, 42, 22].map(
          (height, index) => (
            <span
              key={`${height}-${index}`}
              className="flex-1 rounded-full"
              style={{
                height,
                background:
                  index % 3 === 0 ? template.secondary : template.accent,
                boxShadow: `0 0 12px ${template.glow}`,
              }}
            />
          ),
        )}
      </span>
    </span>
  );
}
