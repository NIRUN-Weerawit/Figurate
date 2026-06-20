import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { registerAllPrimitives } from "./primitives";
import "./styles.css";

// Initialize the primitive registry before any rendering happens.
registerAllPrimitives();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);