import type React from "react";
import { GlassSymbol } from "./GlassSymbol";

const SuccessSymbol: React.FC = () => {
  return (
    <GlassSymbol tone="success">
      <path
        d="m25 39 10 10 21-23"
        stroke="white"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </GlassSymbol>
  );
};

export { SuccessSymbol };
