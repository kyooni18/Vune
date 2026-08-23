import { createApp } from "vue"
import { VuneView } from "@vune-ui/vue"
import graph from "./ParityGraph.vune"
import "./parity.css"

createApp(VuneView, { render: () => graph() }).mount("#app")
