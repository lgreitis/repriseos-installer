import type React from "react";
import { GlassSymbol } from "./GlassSymbol";

const InformationSymbol: React.FC = () => {
  return (
    <GlassSymbol tone="information">
      <circle cx="40" cy="25" r="3" fill="white" />
      <path d="M40 36v19" stroke="white" strokeWidth="5" strokeLinecap="round" />
    </GlassSymbol>
  );
};

export { InformationSymbol };
