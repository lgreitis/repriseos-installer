import React from "react";

const useHeadingFocus = (focusOnMount = true) => {
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const focusHeading = React.useCallback(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  React.useEffect(() => {
    if (focusOnMount) focusHeading();
  }, [focusOnMount, focusHeading]);

  return { headingRef, focusHeading };
};

export { useHeadingFocus };
