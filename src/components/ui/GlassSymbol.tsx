import React from "react";

const palettes = {
  information: {
    top: "#78b4e5",
    middle: "#3e89c5",
    bottom: "#286da5",
    rim: "#376f9d",
    shadow: "#244b6b",
  },
  success: {
    top: "#a0cd8d",
    middle: "#6aa451",
    bottom: "#477c36",
    rim: "#548143",
    shadow: "#34512b",
  },
};

interface IGlassSymbolProps {
  tone: keyof typeof palettes;
  children: React.ReactNode;
}

const GlassSymbol: React.FC<IGlassSymbolProps> = ({ tone, children }) => {
  const id = React.useId();
  const palette = palettes[tone];

  return (
    <svg className="h-full w-full" viewBox="0 0 80 80" fill="none" aria-hidden="true">
      <defs>
        <linearGradient
          id={`${id}-glass`}
          x1="40"
          y1="4"
          x2="40"
          y2="74"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor={palette.top} />
          <stop offset="0.5" stopColor={palette.middle} />
          <stop offset="1" stopColor={palette.bottom} />
        </linearGradient>
        <linearGradient
          id={`${id}-shine`}
          x1="40"
          y1="6"
          x2="40"
          y2="40"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="white" stopOpacity="0.55" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="40" cy="41" r="35" fill={palette.shadow} opacity="0.12" />
      <circle cx="40" cy="39" r="35" fill={`url(#${id}-glass)`} stroke={palette.rim} />
      <circle cx="40" cy="39" r="33.5" stroke="white" strokeOpacity="0.3" />
      <ellipse cx="40" cy="25" rx="28" ry="18" fill={`url(#${id}-shine)`} />
      {children}
    </svg>
  );
};

export { GlassSymbol };
