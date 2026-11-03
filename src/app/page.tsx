import { Film, Heart, ExternalLink, Github } from "lucide-react";

import { VideoConverter } from "@/components/video-converter";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b-2 border-[var(--brutal-border)] bg-foreground text-background">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center border-2 border-[var(--brutal-border)] bg-secondary text-black shadow-[3px_3px_0_0_#fde047]">
              <Film className="h-5 w-5" />
            </span>
            <div className="leading-none">
              <p className="text-sm font-extrabold uppercase tracking-tight">
                ASCII Motion
              </p>
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-background/60">
                Video → text-art
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://sudaisalamboy.github.io/portfolio/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 border-2 border-[var(--brutal-border)] bg-secondary px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-black shadow-[2px_2px_0_0_var(--brutal-shadow)] transition hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Hire Me</span>
            </a>
            <a
              href="https://github.com/sudaisalamboy/ascii-motion"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 border-2 border-[var(--brutal-border)] bg-card px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-foreground shadow-[2px_2px_0_0_var(--brutal-shadow)] transition hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none"
            >
              <Github className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Source</span>
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <VideoConverter />
      </main>

      <footer className="mt-auto border-t-2 border-[var(--brutal-border)] bg-foreground text-background">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-5 text-xs sm:flex-row sm:px-6">
          <p className="flex items-center gap-1.5 font-medium uppercase tracking-wide">
            <Heart className="h-3.5 w-3.5 text-secondary" />
            Two modes · your CPU or the server
          </p>
          <div className="flex items-center gap-4">
            <a
              href="https://sudaisalamboy.github.io/portfolio/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 font-mono uppercase tracking-widest text-background/70 transition hover:text-secondary"
            >
              <ExternalLink className="h-3 w-3" />
              sudaisalamboy.dev
            </a>
            <p className="font-mono uppercase tracking-widest text-background/60">
              ffmpeg + canvas
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
