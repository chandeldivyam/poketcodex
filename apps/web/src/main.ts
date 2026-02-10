import { appSubtitle } from "./lib/content.js";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("App root element is missing");
}

root.innerHTML = `
  <section class="container">
    <h1>PocketCodex</h1>
    <p>${appSubtitle()}</p>
  </section>
`;
