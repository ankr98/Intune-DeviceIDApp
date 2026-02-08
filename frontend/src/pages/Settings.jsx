import { 
  Container, Paper, Title, TextInput, PasswordInput, Button, Stack, Group, Switch, Text, useMantineColorScheme, useComputedColorScheme, Notification, LoadingOverlay 
} from '@mantine/core';
import { useState } from 'react';
import { IconMoon, IconSun, IconCheck, IconX } from '@tabler/icons-react';

function Settings() {
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme('light', { getInitialValueInEffect: true });
  
  const toggleColorScheme = () => {
    setColorScheme(computedColorScheme === 'dark' ? 'light' : 'dark');
  };

  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  
  // Test Connection State
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // null | 'success' | 'error'
  const [testMessage, setTestMessage] = useState('');

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const response = await fetch("http://127.0.0.1:8000/test-azure-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            tenant_id: tenantId,
            client_id: clientId,
            client_secret: clientSecret
        })
      });

      const data = await response.json();

      if (response.ok) {
        setTestResult('success');
        setTestMessage("Success! Connected to Azure Tenant.");
      } else {
        setTestResult('error');
        setTestMessage(data.detail || "Connection failed. Check your IDs.");
      }
    } catch (error) {
      setTestResult('error');
      setTestMessage("Could not reach backend server.");
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    // Save logic here (e.g. LocalStorage or Backend)
    localStorage.setItem("azure_config", JSON.stringify({ tenantId, clientId, clientSecret }));
    alert("Settings Saved locally!");
  };

  return (
    <Container size="sm" py="xl">
      <Paper shadow="sm" p="xl" radius="md" withBorder style={{ position: 'relative' }}>
        <LoadingOverlay visible={testing} overlayProps={{ radius: "sm", blur: 2 }} />
        
        <Stack gap="lg">
          <div>
            <Title order={3}>Application Settings</Title>
            <Text c="dimmed" size="sm">Configure app behavior and connections</Text>
          </div>

          {/* Theme Toggle */}
          <Paper withBorder p="md" radius="md" bg={computedColorScheme === 'dark' ? 'dark.6' : 'gray.0'}>
            <Group justify="space-between">
              <Group gap="xs">
                {computedColorScheme === 'dark' ? <IconMoon size={20} /> : <IconSun size={20} />}
                <Text fw={500}>Appearance</Text>
              </Group>
              <Switch 
                size="md" 
                onLabel="Dark" 
                offLabel="Light" 
                checked={computedColorScheme === 'dark'}
                onChange={toggleColorScheme}
              />
            </Group>
          </Paper>

          <Title order={5} mt="md">Azure Service Principal</Title>
          
          <TextInput 
            label="Tenant ID" 
            placeholder="e.g. 550e8400-e29b..." 
            value={tenantId}
            onChange={(e) => setTenantId(e.currentTarget.value)}
          />
          
          <TextInput 
            label="Client ID" 
            placeholder="e.g. 12345678-abcd..." 
            value={clientId}
            onChange={(e) => setClientId(e.currentTarget.value)}
          />

          <PasswordInput 
            label="Client Secret" 
            placeholder="Enter your Azure client secret" 
            value={clientSecret}
            onChange={(e) => setClientSecret(e.currentTarget.value)}
          />

          {/* TEST RESULT NOTIFICATION */}
          {testResult && (
            <Notification 
              icon={testResult === 'success' ? <IconCheck size={18} /> : <IconX size={18} />}
              color={testResult === 'success' ? 'teal' : 'red'}
              title={testResult === 'success' ? 'Connection Verified' : 'Connection Failed'}
              onClose={() => setTestResult(null)}
            >
              {testMessage}
            </Notification>
          )}

          <Group justify="space-between" mt="xl">
             <Button variant="default" onClick={handleTestConnection}>Test Connection</Button>
             <Button onClick={handleSave} color="blue">Save Configuration</Button>
          </Group>

        </Stack>
      </Paper>
    </Container>
  );
}

export default Settings;