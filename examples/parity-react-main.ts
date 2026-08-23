import { createElement } from "react"
import { createRoot } from "react-dom/client"
import { view } from "@vune-ui/react"
import graph from "./ParityGraph.vune"
import "./parity.css"

createRoot(document.getElementById("app")!).render(createElement(view(() => graph())))
