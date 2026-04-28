import React from "react";
import ReactDOM from "react-dom/client";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

import { App } from "./app/App";
import "./styles/reset.css";
import "antd/dist/reset.css";
import "./styles/tokens.css";
import "./styles/theme.css";

dayjs.locale("zh-cn");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
