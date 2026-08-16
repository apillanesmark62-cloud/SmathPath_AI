import React from "react";
import { createRoot } from "react-dom/client";
import SmartPath from "./SmartPath.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SmartPath />
  </React.StrictMode>
);
