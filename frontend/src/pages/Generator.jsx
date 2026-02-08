import { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { 
  Container, Paper, Title, Select, Button, Text, Group, Stack, 
  TextInput, Table, ActionIcon, Grid, Badge, ScrollArea, Loader, Modal // <--- Added Modal
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconHistory, IconCloudUpload, IconCheck, IconX } from '@tabler/icons-react';

function Generator() {
  // --- 1. STATE MANAGEMENT ---
  const [manufacturers, setManufacturers] = useState([]);
  const [models, setModels] = useState([]);
  
  // Selection State
  const [selectedMan, setSelectedMan] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  
  // App Logic State
  const [deviceQueue, setDeviceQueue] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  
  // Memory State for the "Recall" feature
  const [lastUsed, setLastUsed] = useState(null);

  // --- STATE FOR PUSH MODAL ---
  const [opened, { open, close }] = useDisclosure(false);
  const [pushResults, setPushResults] = useState([]);
  const [isPushing, setIsPushing] = useState(false);

  // --- 2. DATA FETCHING ---
  
  // Initial load: Get vendors
  useEffect(() => {
    fetch("http://127.0.0.1:8000/manufacturers")
      .then(res => res.json())
      .then(data => setManufacturers(data))
      .catch(err => console.error("Backend offline?", err));
  }, []);

  // Dynamic load: Get models when Manufacturer changes
  useEffect(() => {
    if (selectedMan) {
      setLoadingModels(true);
      fetch(`http://127.0.0.1:8000/models?manufacturer=${selectedMan}`)
        .then(res => res.json())
        .then(data => {
          setModels(data);
          if (selectedModel && !data.includes(selectedModel)) {
             setSelectedModel(""); 
          }
          setLoadingModels(false);
        })
        .catch(() => setLoadingModels(false));
    } else {
      setModels([]);
    }
  }, [selectedMan]);

  // --- 3. ACTION FUNCTIONS ---

  const addDeviceToQueue = () => {
    if (!selectedMan || !selectedModel || !serialNumber) {
      alert("Please fill in all fields.");
      return;
    }

    const newDevice = {
      manufacturer: selectedMan,
      model: selectedModel,
      serial: serialNumber.toUpperCase().trim()
    };

    setDeviceQueue([...deviceQueue, newDevice]);
    setLastUsed({ manufacturer: selectedMan, model: selectedModel });
    setSerialNumber(""); 
  };

  const removeDevice = (indexToRemove) => {
    setDeviceQueue(deviceQueue.filter((_, index) => index !== indexToRemove));
  };

  const recallLastUsed = () => {
    if (!lastUsed) return;
    setSelectedMan(lastUsed.manufacturer);
    setSelectedModel(lastUsed.model);
  };

  const exportToCSV = () => {
    if (deviceQueue.length === 0) return;

    const exportData = deviceQueue.map(dev => [
      dev.manufacturer,
      dev.model,
      dev.serial
    ]);

    const csv = Papa.unparse({
      data: exportData,
      fields: null
    }, { header: false });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'Intune_Corporate_Identifiers.csv');
    link.click();
  };

  // --- NEW: PUSH TO INTUNE LOGIC ---
  const handlePushToIntune = async () => {
    // 1. Retrieve Credentials from LocalStorage
    const storedConfig = localStorage.getItem("azure_config");
    if (!storedConfig) {
      alert("Missing Azure Credentials! Please configure them in the Settings tab.");
      return;
    }
    const config = JSON.parse(storedConfig);

    // 2. Prepare UI
    setIsPushing(true);
    setPushResults([]);
    open(); // Open the modal

    // 3. Send to Backend
    try {
      const response = await fetch("http://127.0.0.1:8000/push-to-intune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: config.tenantId, // Note: frontend usually saves camelCase, backend needs snake_case
          client_id: config.clientId,
          client_secret: config.clientSecret,
          devices: deviceQueue
        })
      });

      const data = await response.json();
      setPushResults(data.results);

    } catch (error) {
      setPushResults([{ serial: "System", status: 'error', message: 'Failed to contact backend server.' }]);
    } finally {
      setIsPushing(false);
    }
  };

  const optionsFilter = ({ options, search }) => {
    const splittedSearch = search.toLowerCase().trim().split(" ");
    return options.filter((option) => {
      const label = option.label.toLowerCase();
      return splittedSearch.every((searchWord) => label.includes(searchWord));
    });
  };

  // --- 4. THE UI ---
  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        
        {/* HEADER */}
        <Paper shadow="xs" p="xl" radius="md" withBorder>
          <Group justify="space-between">
            <div>
              <Title order={2} c="blue">Intune Standardizer</Title>
              <Text c="dimmed" size="sm">Corporate Device Identifier Portal</Text>
            </div>
          </Group>
        </Paper>

        <Grid gutter="lg">
          
          {/* LEFT COLUMN: INPUT FORM */}
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Paper shadow="sm" p="lg" radius="md" withBorder>
              <Title order={4} mb="md">Add Device</Title>
              
              <Stack gap="md">
                <Select
                  label="Manufacturer"
                  placeholder="Select Vendor"
                  data={manufacturers}
                  value={selectedMan}
                  onChange={setSelectedMan}
                  searchable
                />

                <Select
                  label="Model"
                  placeholder={loadingModels ? "Loading..." : "Search Model..."}
                  data={models}
                  value={selectedModel}
                  onChange={setSelectedModel}
                  disabled={!selectedMan}
                  searchable
                  filter={optionsFilter}
                  rightSection={loadingModels ? <Loader size="xs" /> : null}
                />

                <TextInput
                  label="Serial Number"
                  placeholder="e.g. 5CD1234..."
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addDeviceToQueue();
                  }}
                />

                <Button 
                  onClick={addDeviceToQueue} 
                  fullWidth 
                  mt="sm"
                  variant="gradient" 
                  gradient={{ from: 'blue', to: 'cyan', deg: 90 }}
                >
                  Add to Queue
                </Button>

                {lastUsed && (
                  <Button 
                    variant="light" 
                    color="gray" 
                    fullWidth 
                    size="xs"
                    leftSection={<IconHistory size={14} />}
                    onClick={recallLastUsed}
                  >
                    Load Previous: {lastUsed.model}
                  </Button>
                )}

              </Stack>
            </Paper>
          </Grid.Col>

          {/* RIGHT COLUMN: QUEUE TABLE */}
          <Grid.Col span={{ base: 12, md: 8 }}>
            <Paper shadow="sm" p="lg" radius="md" withBorder>
              <Group justify="space-between" mb="md">
                <Group gap="xs">
                  <Title order={4}>Registration Queue</Title>
                  <Badge color="gray" variant="light" size="lg">{deviceQueue.length}</Badge>
                </Group>
                
                <Group gap="xs">
                    <Button 
                        onClick={exportToCSV} 
                        disabled={deviceQueue.length === 0}
                        color="green"
                        variant="light"
                    >
                        Download CSV
                    </Button>

                    {/* --- NEW PUSH BUTTON --- */}
                    <Button
                        onClick={handlePushToIntune}
                        disabled={deviceQueue.length === 0}
                        color="blue"
                        leftSection={<IconCloudUpload size={18} />}
                    >
                        Push to Intune
                    </Button>
                </Group>
              </Group>

              <ScrollArea h={400} type="auto">
                <Table striped highlightOnHover verticalSpacing="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Manufacturer</Table.Th>
                      <Table.Th>Model</Table.Th>
                      <Table.Th>Serial</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Action</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {deviceQueue.length === 0 ? (
                      <Table.Tr>
                        <Table.Td colSpan={4}>
                          <Text c="dimmed" ta="center" py="xl">
                            Queue is empty. Add a device to start.
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ) : (
                      deviceQueue.map((device, index) => (
                        <Table.Tr key={index}>
                          <Table.Td>{device.manufacturer}</Table.Td>
                          <Table.Td>{device.model}</Table.Td>
                          <Table.Td style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#4dabf7' }}>
                            {device.serial}
                          </Table.Td>
                          <Table.Td style={{ textAlign: 'right' }}>
                            <ActionIcon color="red" variant="subtle" onClick={() => removeDevice(index)}>
                              ✕
                            </ActionIcon>
                          </Table.Td>
                        </Table.Tr>
                      ))
                    )}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Paper>
          </Grid.Col>

        </Grid>
      </Stack>

      {/* --- NEW RESULTS MODAL --- */}
      <Modal opened={opened} onClose={close} title="Intune Upload Status" size="lg" centered>
        <Stack>
          {isPushing && (
             <Group justify="center" py="xl">
                <Loader size="md" type="dots" />
                <Text size="sm" c="dimmed">Registering devices with Microsoft Graph...</Text>
             </Group>
          )}
          
          {!isPushing && pushResults.length === 0 && (
            <Text c="dimmed" size="sm">Initializing upload...</Text>
          )}

          {/* Only show table if we have results */}
          {pushResults.length > 0 && (
            <ScrollArea h={300} offsetScrollbars>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Serial</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Details</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {pushResults.map((res, index) => (
                    <Table.Tr key={index}>
                      <Table.Td fw={500} style={{ fontFamily: 'monospace' }}>{res.serial || "N/A"}</Table.Td>
                      <Table.Td>
                        {res.status === 'success' ? (
                          <Badge color="green" variant="light" leftSection={<IconCheck size={12}/>}>Success</Badge>
                        ) : (
                          <Badge color="red" variant="light" leftSection={<IconX size={12}/>}>Failed</Badge>
                        )}
                      </Table.Td>
                      <Table.Td style={{ fontSize: '0.85rem', color: 'gray' }}>
                        {res.message}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
          
          {!isPushing && (
             <Button fullWidth onClick={close} variant="default">Close</Button>
          )}
        </Stack>
      </Modal>

    </Container>
  );
}

export default Generator;