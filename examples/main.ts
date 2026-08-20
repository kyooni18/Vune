import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.js'
import './styles.css'

createRoot(document.getElementById('app')!).render(createElement(App))
