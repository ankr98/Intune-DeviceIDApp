import { 
  Container, Paper, Title, TextInput, PasswordInput, Button, Stack, Group, Text, 
  useMantineColorScheme, useComputedColorScheme, Notification, LoadingOverlay, 
  SegmentedControl, Center, Box, rem
} from '@mantine/core';
import { useState, useEffect } from 'react';
import { IconMoon, IconSun, IconCheck, IconX, IconDeviceFloppy, IconServer } from '@tabler/icons-react';
import { API_URL } from '../config';

// --- CUSTOM STYLES FOR SMOOTH THEME TRANSITION ---
const transitionStyles = `
  /* Apply smooth transition to backgrounds and borders */
  .mantine-Paper-root, .mantine-Container-root, body {
    transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease;
  }
  
  /* Add a subtle glow to the active settings card */
  .settings-card {
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }
  .settings-card:hover {
    box-shadow: 0 8px 30px rgba(0,0,0,0.12);
  }
`;

function Settings() {
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme('light', { getInitialValueInEffect: true });

  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  
  // State
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null);

  // --- 1. LOAD FROM SERVER ---
  useEffect(() => {
    fetch(`${API_URL}/config`)
      .then(res => {
        if (res.ok) return res.json();
        throw new Error("Failed");
      })
      .then(data => {
        if (data.tenant_id) setTenantId(data.tenant_id);
        if (data.client_id) setClientId(data.client_id);
        if (data.client_secret) setClientSecret(data.client_secret);
      })
      .catch(err => console.log("No config found on server yet."));
  }, []);

  // --- 2. TEST CONNECTION ---
  const handleTestConnection = async () => {
    setLoading(true);
    setNotification(null);

    try {
      const response = await fetch(`${API_URL}/test-azure-connection`, {
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
        setNotification({ type: 'success', title: 'Verified', message: "Success! Connected to Azure Tenant." });
      } else {
        setNotification({ type: 'error', title: 'Connection Failed', message: data.detail || "Check your IDs." });
      }
    } catch (error) {
      setNotification({ type: 'error', title: 'Network Error', message: "Could not reach backend server." });
    } finally {
      setLoading(false);
    }
  };

  // --- 3. SAVE TO SERVER ---
  const handleSave = async () => {
    setLoading(true);
    setNotification(null);

    try {
        const response = await fetch(`${API_URL}/config`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                tenant_id: tenantId,
                client_id: clientId,
                client_secret: clientSecret
            })
        });

        if (response.ok) {
            setNotification({ type: 'success', title: 'Saved', message: "Settings saved to Database!" });
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
      <style>{transitionStyles}</style>

      <Paper 
        shadow="md" 
        p="xl" 
        radius="lg" 
        withBorder 
        className="settings-card" 
        style={{ position: 'relative', overflow: 'hidden' }}
      >
        <LoadingOverlay visible={loading} zIndex={1000} overlayProps={{ radius: "sm", blur: 2 }} />
        
        <Stack gap="lg">
          <Group justify="space-between" align="center">
            <div>
              <Title order={3}>Settings</Title>
              <Text c="dimmed" size="sm">Application & Connection Preferences</Text>
            </div>
            
            {/* --- NEW SLIDING TOGGLE --- */}
            <SegmentedControl
              value={computedColorScheme}
              onChange={(value) => setColorScheme(value)}
              radius="xl"
              size="md"
              data={[
                {
                  value: 'light',
                  label: (
                    <Center>
                      <IconSun style={{ width: rem(16), height: rem(16) }} stroke={1.5} />
                      <Box ml={10}>Light</Box>
                    </Center>
                  ),
                },
                {
                  value: 'dark',
                  label: (
                    <Center>
                      <IconMoon style={{ width: rem(16), height: rem(16) }} stroke={1.5} />
                      <Box ml={10}>Dark</Box>
                    </Center>
                  ),
                },
              ]}
            />
          </Group>

          <Paper withBorder p="md" radius="md" bg={computedColorScheme === 'dark' ? 'dark.6' : 'gray.0'}>
            <Group>
                <IconServer size={24} style={{ opacity: 0.7 }} />
                <div>
                    <Text fw={600}>Azure Service Principal</Text>
                    <Text size="xs" c="dimmed">
                        Credentials are stored securely in your local database (catalogue.db).
                    </Text>
                </div>
            </Group>
          </Paper>

          <TextInput 
            label="Tenant ID" 
            placeholder="e.g. 550e8400-e29b..." 
            value={tenantId}
            onChange={(e) => setTenantId(e.currentTarget.value)}
            radius="md"
          />
          
          <TextInput 
            label="Client ID (App ID)" 
            placeholder="e.g. 12345678-abcd..." 
            value={clientId}
            onChange={(e) => setClientId(e.currentTarget.value)}
            radius="md"
          />

          <PasswordInput 
            label="Client Secret" 
            placeholder="Value from Certificates & Secrets" 
            description="If previously saved, this may appear as stars"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.currentTarget.value)}
            radius="md"
          />

          {/* NOTIFICATION AREA */}
          {notification && (
            <Notification 
              icon={notification.type === 'success' ? <IconCheck size={18} /> : <IconX size={18} />}
              color={notification.type === 'success' ? 'teal' : 'red'}
              title={notification.title}
              onClose={() => setNotification(null)}
              withBorder
              radius="md"
            >
              {notification.message}
            </Notification>
          )}

          <Group justify="space-between" mt="xl">
             <Button variant="default" radius="md" onClick={handleTestConnection}>
                Test Connection
             </Button>
             
             <Button 
                onClick={handleSave} 
                color="blue" 
                radius="md"
                leftSection={<IconDeviceFloppy size={18}/>}
             >
                Save Configuration
             </Button>
          </Group>

        </Stack>
      </Paper>
    </Container>
  );
}

export default Settings;