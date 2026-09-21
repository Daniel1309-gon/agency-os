interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className = 'h-10 w-10' }: BrandMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-lg border border-white/10 bg-gradient-to-br from-zinc-800 to-zinc-950 text-xs font-semibold tracking-tight text-zinc-100 shadow-sm ${className}`}
    >
      AO
    </span>
  );
}
