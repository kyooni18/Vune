import { mount } from "@muse/web"
import graph from "./ParityGraph.muse"
import "./parity.css"

mount(graph(), document.getElementById("app")!)
