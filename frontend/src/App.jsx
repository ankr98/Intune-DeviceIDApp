import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Container, Tabs, Paper, Group, Text, ThemeIcon, Title } from '@mantine/core';
import Generator from './pages/Generator';
import Settings from './pages/Settings';

// We need a wrapper component to use the 'useNavigate' hook
function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Container size="xl" py="lg">
      <Paper shadow="xs" p="md" mb="lg" radius="md" withBorder>
        <Group justify="space-between" align="center">
          
          {/* Logo / Title Area */}
          <Group>
            <ThemeIcon size="lg" variant="gradient" gradient={{ from: 'indigo', to: 'cyan' }}>
              ID
            </ThemeIcon>
            <Title order={4}>Intune Corporate Device Registration</Title>
          </Group>

          {/* Navigation Tabs */}
          <Tabs 
            value={location.pathname} 
            onChange={(value) => navigate(value)} 
            variant="pills"
          >
            <Tabs.List>
              <Tabs.Tab value="/">Generator</Tabs.Tab>
              <Tabs.Tab value="/settings">Settings</Tabs.Tab>
            </Tabs.List>
          </Tabs>

        </Group>
      </Paper>

      {/* The Page Content Renders Here */}
      <Routes>
        <Route path="/" element={<Generator />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>

    </Container>
  );
}

// The Main Entry Point
function App() {
  return (
    <Router>
      <AppShell />
    </Router>
  );
}

export default App;