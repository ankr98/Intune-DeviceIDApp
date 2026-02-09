import { 
  Container, Paper, Title, TextInput, PasswordInput, Button, Stack, Group, Switch, Text, useMantineColorScheme, useComputedColorScheme, Notification, LoadingOverlay 
} from '@mantine/core';
import { useState, useEffect } from 'react'; // Added useEffect
import { IconMoon, IconSun, IconCheck, IconX, IconDeviceFloppy } from '@tabler/icons-react';

function Settings() {
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme('light', { getInitialValueInEffect: true });
  
  const toggleColorScheme = () => {
    setColorScheme(computedColorScheme === 'dark' ? 'light' : 'dark');
  };

  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  
  // Test & Save State
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null); // { type: 'success'|'error', message: '' }

  // --- 1. LOAD SETTINGS FROM SERVER ON STARTUP ---
  useEffect(() => {
    fetch('http://127.0.0.1:8000/config')
      .then(res => {
        if (res.ok) return res.json();
        throw new Error("Failed");
      })
      .then(data => {
        if (data.tenant_id) setTenantId(data.tenant_id);
        if (data.client_id) setClientId(data.client_id);
        if (data.client_secret) setClientSecret(data.client_secret); // Will likely be '********'
      })
      .catch(err => console.log("No config found on server yet."));
  }, []);

  // --- 2. TEST CONNECTION (Sends current form data) ---
  const handleTestConnection = async () => {
    setLoading(true);
    setNotification(null);

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
        setNotification({ type: 'success', title: 'Connection Verified', message: "Success! Connected to Azure Tenant." });
      } else {
        setNotification({ type: 'error', title: 'Connection Failed', message: data.detail || "Check your IDs." });
      }
    } catch (error) {
      setNotification({ type: 'error', title: 'Network Error', message: "Could not reach backend server." });
    } finally {
      setLoading(false);
    }
  };

  // --- 3. SAVE TO SERVER (Writes to catalogue.db) ---
  const handleSave = async () => {
    setLoading(true);
    setNotification(null);

    try {
        const response = await fetch("http://127.0.0.1:8000/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                tenant_id: tenantId,
                client_id: clientId,
                client_secret: clientSecret
            })
        });

        if (response.ok) {
            setNotification({ type: 'success', title: 'Saved', message: "Settings saved to Server Database!" });
        } else {
            const err = await response.json();
            setNotification({ type: 'error', title: 'Save Failed', message: err.detail || "Unknown error" });
        }
    } catch (error) {
        setNotification({ type: 'error', title: 'Error', message: "Could not save to backend." });
    } finally {
        setLoading(false);
    }
  };

  return (
    <Container size="sm" py="xl">
      <Paper shadow="sm" p="xl" radius="md" withBorder style={{ position: 'relative' }}>
        <LoadingOverlay visible={loading} overlayProps={{ radius: "sm", blur: 2 }} />
        
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

          {/* NOTIFICATION AREA */}
          {notification && (
            <Notification 
              icon={notification.type === 'success' ? <IconCheck size={18} /> : <IconX size={18} />}
              color={notification.type === 'success' ? 'teal' : 'red'}
              title={notification.title}
              onClose={() => setNotification(null)}
            >
              {notification.message}
            </Notification>
          )}

          <Group justify="space-between" mt="xl">
             <Button variant="default" onClick={handleTestConnection}>Test Connection</Button>
             <Button onClick={handleSave} color="blue" leftSection={<IconDeviceFloppy size={18}/>}>Save to Server</Button>
          </Group>

        </Stack>
      </Paper>
    </Container>
  );
}

export default Settings;