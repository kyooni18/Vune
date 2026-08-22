import { createApp } from "vue"
import { MuseView } from "@muse/vue"
import graph from "./ParityGraph.muse"
import "./parity.css"

createApp(MuseView, { render: () => graph() }).mount("#app")
