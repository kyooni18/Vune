import { createElement } from "react"
import { createRoot } from "react-dom/client"
import Showcase from "./Showcase.vune.js"
import "./showcase.css"

createRoot(document.getElementById("app")!).render(createElement(Showcase))
