import React from 'react'
import ReactDOM from 'react-dom/client'
import { MantineProvider, createTheme } from '@mantine/core';
import App from './App'

// 1. Import the core styles! (Crucial for v7+)
import '@mantine/core/styles.css';

// 2. You can create a custom theme here (optional, but cool)
const theme = createTheme({
  primaryColor: 'blue',
  fontFamily: 'Open Sans, sans-serif',
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <App />
    </MantineProvider>
  </React.StrictMode>,
)