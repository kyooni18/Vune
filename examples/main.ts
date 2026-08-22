import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.js'
import './styles.css'
import './toolchain.css'
import './toolchain.scss'

createRoot(document.getElementById('app')!).render(createElement(App))
