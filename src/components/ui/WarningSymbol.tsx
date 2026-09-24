import React from "react";

const WarningSymbol: React.FC = () => {
  const id = React.useId();

  return (
    <svg
      className="warning-symbol h-full w-full overflow-visible"
      viewBox="0 0 120 112"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={`${id}-rim`}
          x1="60"
          y1="6"
          x2="60"
          y2="105"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#efbd55" />
          <stop offset="0.5" stopColor="#b57a23" />
          <stop offset="1" stopColor="#93601c" />
        </linearGradient>
        <linearGradient
          id={`${id}-face`}
          x1="60"
          y1="9"
          x2="60"
          y2="102"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fff1b3" />
          <stop offset="0.47" stopColor="#fbd169" />
          <stop offset="0.49" stopColor="#efb73d" />
          <stop offset="1" stopColor="#f6cb5b" />
        </linearGradient>
        <linearGradient
          id={`${id}-shine`}
          x1="60"
          y1="13"
          x2="60"
          y2="98"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="white" stopOpacity="0.9" />
          <stop offset="1" stopColor="white" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      <path
        d="M51.3 12.7c3.9-6.8 13.5-6.8 17.4 0l45.5 78.7c3.9 6.7-.9 15.1-8.7 15.1h-91c-7.8 0-12.6-8.4-8.7-15.1L51.3 12.7Z"
        fill={`url(#${id}-rim)`}
      />
      <path
        d="M53.5 14c2.9-5 10.1-5 13 0l45.5 78.7c2.9 5-.7 11.3-6.5 11.3h-91c-5.8 0-9.4-6.3-6.5-11.3L53.5 14Z"
        fill={`url(#${id}-face)`}
      />
      <path
        d="M54.8 15.2c2.3-4 8.1-4 10.4 0l45 78c2.3 4-.6 9.1-5.2 9.1H15c-4.6 0-7.5-5.1-5.2-9.1l45-78Z"
        stroke={`url(#${id}-shine)`}
        strokeWidth="1.5"
      />
      <path
        d="M53.7 39.5c-.2-3.5 2.6-6.5 6.3-6.5s6.5 3 6.3 6.5l-2 31.8c-.1 2.3-2 4.1-4.3 4.1s-4.2-1.8-4.3-4.1l-2-31.8Z"
        fill="#593d20"
      />
      <circle cx="60" cy="88" r="5.6" fill="#593d20" />
      <path
        d="M54 39.5c-.2-3.3 2.5-6.2 6-6.2"
        stroke="#382818"
        strokeOpacity="0.4"
        strokeWidth="1.4"
      />
    </svg>
  );
};

export { WarningSymbol };
