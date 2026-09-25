type EyeIconProps = {
  isVisible: boolean;
};

export function EyeIcon({ isVisible }: EyeIconProps) {
  return isVisible ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.7 5.2A10.9 10.9 0 0 1 12 5c5 0 8.5 4 9.5 7-.3 1-1 2.2-2 3.2" />
      <path d="M6.2 6.2C4.3 7.4 3.2 9.2 2.5 12c1 3 4.5 7 9.5 7 1.5 0 2.8-.4 4-.9" />
    </svg>
  );
}
