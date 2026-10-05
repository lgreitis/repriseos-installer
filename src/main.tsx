import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

async function render() {
  const preview = import.meta.env.DEV && new URLSearchParams(location.search).has("dev-panel");
  const development = preview ? await import("./dev/DevPanel") : null;
  development?.initializePreview();
  const Root = development?.DevPanel ?? App;
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );
}

void render();
