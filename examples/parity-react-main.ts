import { createElement } from "react"
import { createRoot } from "react-dom/client"
import { view } from "@muse/react"
import graph from "./ParityGraph.muse"
import "./parity.css"

createRoot(document.getElementById("app")!).render(createElement(view(() => graph())))
