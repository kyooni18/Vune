import { createElement } from "react"
import { createRoot } from "react-dom/client"
import Showcase from "./Showcase.muse.js"
import "./showcase.css"

createRoot(document.getElementById("app")!).render(createElement(Showcase))
