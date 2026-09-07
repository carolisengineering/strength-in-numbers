import { bootstrap } from "./bootstrap";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element in index.html");
}

bootstrap(rootElement);
